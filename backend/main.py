from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agent_loop import AgentLoopController
from chat_history import ChatHistoryManager
from mcp_manager import MCPManager
from model_handler import OllamaHandler
from sub_agent import SubAgentRole, SubAgentRunner
from task_api import router as task_router, fw_router
from task_manager import TaskManager, TaskStep
from tool_executor import SafeToolExecutor

TOOL_LOOP_LIMIT = 4
TEXT_CHUNK_SIZE = 180

task_manager_singleton = TaskManager.get_instance()
sub_agent_runner_singleton = SubAgentRunner.get_instance()

_spawn_pattern_compiled = False
SPAWN_PATTERN = None


def _get_spawn_pattern():
    global SPAWN_PATTERN, _spawn_pattern_compiled
    if SPAWN_PATTERN is None:
        import re
        SPAWN_PATTERN = re.compile(
            r"^spawn:\s*(.+?)(?:\s*\|\s*(.+?))*(?:\s*\|\s*(.+?))*$",
            re.IGNORECASE | re.DOTALL,
        )
        _spawn_pattern_compiled = True
    return SPAWN_PATTERN


@asynccontextmanager
async def lifespan(app: FastAPI):
    from task_api import set_mcp_manager, set_file_watcher
    from file_watcher import FileWatcher

    data_dir = os.environ.get("DATA_DIR", os.path.join(os.path.expanduser("~"), ".offline-ai-chat", "sessions"))
    os.makedirs(data_dir, exist_ok=True)
    print(f"Backend initialized. Data directory: {data_dir}")
    app.state.mcp_manager = mcp_manager
    app.state.task_manager = task_manager

    file_watcher = FileWatcher.get_instance()
    set_mcp_manager(mcp_manager)
    set_file_watcher(file_watcher)
    app.state.file_watcher = file_watcher

    try:
        settings = chat_history_manager.load_settings()
        await mcp_manager.refresh_all(settings)
    except Exception as exc:
        print(f"MCP startup refresh failed: {exc}")
    try:
        yield
    finally:
        try:
            await mcp_manager.shutdown()
        except Exception as exc:
            print(f"MCP shutdown failed: {exc}")
        try:
            await task_manager.shutdown()
        except Exception as exc:
            print(f"Task manager shutdown failed: {exc}")
        try:
            await file_watcher.shutdown()
        except Exception as exc:
            print(f"File watcher shutdown failed: {exc}")


app = FastAPI(
    title="Offline AI Chat API",
    description="Backend API for offline AI desktop chat application",
    lifespan=lifespan,
)

app.include_router(task_router)
app.include_router(fw_router)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "null,http://127.0.0.1,http://localhost").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

ollama_handler = OllamaHandler()
chat_history_manager = ChatHistoryManager()
tool_executor = SafeToolExecutor()
mcp_manager = MCPManager()
agent_loop_controller = AgentLoopController(ollama_handler, mcp_manager=mcp_manager)
task_manager = TaskManager.get_instance()


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    model: str
    history: List[Dict[str, str]] = Field(default_factory=list)
    temperature: Optional[float] = 0.7
    system_prompt: Optional[str] = ""
    session_id: Optional[str] = None
    agent_settings: Dict[str, Any] = Field(default_factory=dict)


class SessionRequest(BaseModel):
    title: Optional[str] = None
    model: str
    messages: List[Dict[str, str]] = Field(default_factory=list)


class SettingsRequest(BaseModel):
    theme: str = "dark"
    systemPrompt: str = "You are a helpful AI assistant. Provide clear, concise responses."
    temperature: float = 0.7
    defaultModel: str = "llama3"
    developerMode: bool = False
    agenticCloudMode: bool = False
    skills: List[Dict[str, Any]] = Field(default_factory=list)
    monthlyTokenLimit: int = 200000
    mcpServers: List[Dict[str, Any]] = Field(default_factory=list)
    sidebarWidth: int = 300
    toolAutomationEnabled: bool = True
    agentModeEnabled: bool = False
    strictPermissionMode: bool = False
    maxAgentLoopDepth: int = 5
    networkToolEnabled: bool = False


class ToolConfirmationRequest(BaseModel):
    requestId: str


class ToolCancelRequest(BaseModel):
    requestId: str


class AgentProposalDecisionRequest(BaseModel):
    requestId: str
    decision: str
    rememberForSession: bool = False
    editedParams: Optional[Dict[str, Any]] = None


def _try_spawn_tasks(message: str, model: str, temperature: float) -> Optional[StreamingResponse]:
    text = str(message or "").strip()
    match = _get_spawn_pattern().match(text)
    if not match:
        return None
    parts = [g.strip() for g in match.groups() if g and g.strip()]
    if not parts:
        return None

    spawned = []

    async def generate():
        for i, goal in enumerate(parts):
            role = SubAgentRole.PLANNER if i == 0 else SubAgentRole.FILE
            try:
                task = await task_manager_singleton.submit(
                    title=goal[:80],
                    description=goal,
                    role=TaskStep(role.value),
                    model=model,
                    temperature=temperature,
                )
                await sub_agent_runner_singleton.spawn(
                    goal=goal,
                    role=role,
                    model=model,
                    temperature=temperature,
                    task_id=task.id,
                )
                spawned.append(goal[:60])
                yield f"data: {json.dumps({'type': 'content', 'content': f'[Task {i + 1}] Spawned: {goal[:60]}'})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'content', 'content': f'[Task {i + 1}] Failed to spawn: {exc}'})}\n\n"
        yield f"data: {json.dumps({'type': 'content', 'content': f'Done. {len(spawned)} task(s) created.'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


def normalize_chat_role(role: str) -> str:
    normalized = str(role or "").strip().lower()
    if normalized in {"assistant", "ai", "bot", "model"}:
        return "assistant"
    if normalized == "system":
        return "system"
    return "user"


def build_messages(request: ChatRequest, enable_tools: bool) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []
    system_prompt = str(request.system_prompt or "").strip()

    if enable_tools:
        tool_prompt = tool_executor.get_tool_system_prompt()
        system_prompt = f"{system_prompt}\n\n{tool_prompt}".strip() if system_prompt else tool_prompt

    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    for msg in request.history:
        messages.append(
            {
                "role": normalize_chat_role(msg.get("role", "user")),
                "content": msg.get("content", ""),
            }
        )

    messages.append({"role": "user", "content": request.message})
    return messages


async def stream_plain_text(text: str):
    safe_text = str(text or "")
    if not safe_text:
        yield f"data: {json.dumps({'content': '*No response content returned.*'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    for idx in range(0, len(safe_text), TEXT_CHUNK_SIZE):
        chunk = safe_text[idx: idx + TEXT_CHUNK_SIZE]
        yield f"data: {json.dumps({'content': chunk})}\n\n"
        await asyncio.sleep(0)

    yield f"data: {json.dumps({'done': True})}\n\n"


async def stream_agent_events(request: ChatRequest):
    try:
        async for event in agent_loop_controller.stream_events(
            message=request.message,
            model=request.model,
            history=request.history,
            temperature=float(request.temperature or 0.7),
            system_prompt=str(request.system_prompt or ""),
            session_id=request.session_id,
            agent_settings=request.agent_settings,
        ):
            yield f"data: {json.dumps(event)}\n\n"
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'content', 'content': f'**Agent error:** {exc}'})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"


@app.get("/health")
async def health_check():
    return {"status": "healthy", "backend": "running"}


@app.get("/models")
async def get_models():
    try:
        models = await ollama_handler.get_available_models()
        return {"models": models}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch models: {str(exc)}")


@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    spawn_response = _try_spawn_tasks(request.message, request.model, request.temperature or 0.7)
    if spawn_response:
        return spawn_response
    try:
        async def generate_response():
            try:
                enable_tools = tool_executor.should_attempt_tooling(request.message)
                messages = build_messages(request, enable_tools=enable_tools)

                if not enable_tools:
                    async for chunk in ollama_handler.stream_chat(
                        model=request.model,
                        messages=messages,
                        temperature=request.temperature,
                    ):
                        if isinstance(chunk, dict):
                            if "content" in chunk:
                                yield f"data: {json.dumps(chunk)}\n\n"
                            elif "done" in chunk:
                                yield f"data: {json.dumps({'done': True})}\n\n"
                            elif "error" in chunk:
                                yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                    return

                inferred_action = tool_executor.infer_action_from_message(request.message)
                if inferred_action:
                    if inferred_action.get("kind") == "message":
                        async for chunk in stream_plain_text(inferred_action.get("content", "")):
                            yield chunk
                        return

                    direct_result = tool_executor.prepare_or_execute(inferred_action["tool_call"])
                    if direct_result.get("status") == "pending_confirmation":
                        yield f"data: {json.dumps({'tool_request': direct_result})}\n\n"
                        return

                    direct_result_message = tool_executor.build_tool_result_message(direct_result)
                    messages.append({"role": "system", "content": direct_result_message})
                    response_text = await ollama_handler.chat(
                        model=request.model,
                        messages=messages,
                        temperature=request.temperature,
                    )
                    fallback_text = tool_executor.format_tool_result_for_user(direct_result)
                    async for chunk in stream_plain_text(response_text or fallback_text):
                        yield chunk
                    return

                for _ in range(TOOL_LOOP_LIMIT):
                    response_text = await ollama_handler.chat(
                        model=request.model,
                        messages=messages,
                        temperature=request.temperature,
                    )

                    tool_call = tool_executor.parse_tool_call(response_text)
                    if not tool_call:
                        async for chunk in stream_plain_text(response_text):
                            yield chunk
                        return

                    tool_result = tool_executor.prepare_or_execute(tool_call)
                    if tool_result.get("status") == "pending_confirmation":
                        yield f"data: {json.dumps({'tool_request': tool_result})}\n\n"
                        return

                    messages.append({"role": "assistant", "content": response_text})
                    messages.append(
                        {
                            "role": "system",
                            "content": tool_executor.build_tool_result_message(tool_result),
                        }
                    )

                yield f"data: {json.dumps({'error': 'Tool loop limit reached. Please simplify the request and try again.'})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"

        return StreamingResponse(generate_response(), media_type="text/event-stream")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/agent/chat")
async def agent_chat_endpoint(request: ChatRequest):
    return StreamingResponse(stream_agent_events(request), media_type="text/event-stream")


@app.post("/agent/proposals/decision")
async def resolve_agent_proposal(request: AgentProposalDecisionRequest):
    try:
        return agent_loop_controller.resolve_proposal(
            request.requestId,
            decision=request.decision,
            remember_for_session=request.rememberForSession,
            edited_params=request.editedParams,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Pending proposal not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/tools/confirm")
async def confirm_tool_action(request: ToolConfirmationRequest):
    try:
        result = tool_executor.confirm_request(request.requestId)
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Pending action not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/tools/cancel")
async def cancel_tool_action(request: ToolCancelRequest):
    try:
        tool_executor.cancel_request(request.requestId)
        return {"success": True, "message": "Pending action cancelled."}
    except KeyError:
        raise HTTPException(status_code=404, detail="Pending action not found")


@app.post("/history/save")
async def save_chat_history(session: SessionRequest):
    import traceback

    try:
        session_dict = {
            "title": session.title,
            "model": session.model,
            "messages": session.messages,
        }
        print(f"Save request received: model={session_dict['model']}, messages={len(session_dict['messages'])}")
        session_id = await chat_history_manager.save_session(session_dict)
        print(f"Session saved: {session_id}")
        return {"success": True, "sessionId": session_id}
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error: {str(exc)}")


@app.get("/history/load")
async def load_chat_history():
    try:
        sessions = await chat_history_manager.load_all_sessions()
        return {"sessions": sessions}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/history/{session_id}")
async def load_session(session_id: str):
    try:
        session = await chat_history_manager.load_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/history/{session_id}")
async def delete_session(session_id: str):
    try:
        await chat_history_manager.delete_session(session_id)
        return {"success": True, "message": "Session deleted"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/history/{session_id}")
async def update_session(session_id: str, session: SessionRequest):
    try:
        session_dict = {
            "title": session.title,
            "model": session.model,
            "messages": session.messages,
        }
        updated = await chat_history_manager.update_session(session_id, session_dict)
        if not updated:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"success": True, "sessionId": session_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/history/generate-title")
async def generate_title(messages: List[Dict[str, str]]):
    try:
        title = await chat_history_manager.generate_title(messages)
        return {"title": title}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/settings")
async def get_settings():
    try:
        settings = chat_history_manager.load_settings()
        return settings
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/settings")
async def update_settings(settings: SettingsRequest):
    try:
        payload = settings.model_dump()
        chat_history_manager.save_settings(payload)
        await mcp_manager.refresh_all(payload)
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/mcp/refresh")
async def refresh_mcp_servers():
    try:
        settings = chat_history_manager.load_settings()
        await mcp_manager.refresh_all(settings)
        return {
            "success": True,
            "available": mcp_manager.is_available,
            "importError": mcp_manager.import_error,
            "servers": mcp_manager.get_status(),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/mcp/status")
async def get_mcp_status():
    return {
        "available": mcp_manager.is_available,
        "importError": mcp_manager.import_error,
        "servers": mcp_manager.get_status(),
    }


@app.get("/mcp/tools")
async def get_mcp_tools():
    return {
        "available": mcp_manager.is_available,
        "tools": mcp_manager.get_all_tools(),
    }


@app.post("/mcp/servers/{server_id}/test")
async def test_mcp_server(server_id: str):
    try:
        return await mcp_manager.test_server(server_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="MCP server not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/mcp/servers/{server_id}/reconnect")
async def reconnect_mcp_server(server_id: str):
    try:
        status = await mcp_manager.reconnect_server(server_id)
        return {"success": True, "server": status}
    except KeyError:
        raise HTTPException(status_code=404, detail="MCP server not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/usage")
async def get_usage():
    try:
        settings = chat_history_manager.load_settings()
        token_limit = int(settings.get("monthlyTokenLimit", 200000))
        usage = await chat_history_manager.get_usage_summary(token_limit=token_limit)

        username = os.environ.get("USERNAME") or os.environ.get("USER") or os.path.basename(os.path.expanduser("~"))
        models_path = os.path.join(os.path.expanduser("~"), ".ollama", "models")

        return {
            "accountName": username,
            "plan": "Free",
            "messageCharLimit": 4000,
            "modelsPath": models_path,
            "sessionsPath": chat_history_manager.data_dir,
            "mcpServerCount": len(settings.get("mcpServers", []) or []),
            "toolAutomationEnabled": bool(settings.get("toolAutomationEnabled", True)),
            "auditLogPath": agent_loop_controller.audit_log_path,
            **usage,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
