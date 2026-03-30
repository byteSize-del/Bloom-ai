from __future__ import annotations

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

from chat_history import ChatHistoryManager
from model_handler import OllamaHandler


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_dir = os.environ.get(
        "DATA_DIR",
        os.path.join(os.path.expanduser("~"), ".offline-ai-chat", "sessions"),
    )
    os.makedirs(data_dir, exist_ok=True)
    print(f"Backend initialized. Data directory: {data_dir}")
    yield


app = FastAPI(
    title="Bloom API",
    description="Backend API for Bloom desktop chat",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "null,http://127.0.0.1,http://localhost",
    ).split(",")
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


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    model: str
    history: List[Dict[str, str]] = Field(default_factory=list)
    temperature: Optional[float] = 0.7
    system_prompt: Optional[str] = ""
    session_id: Optional[str] = None


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
    skills: List[Dict[str, Any]] = Field(default_factory=list)
    monthlyTokenLimit: int = 200000
    sidebarWidth: int = 300


def normalize_chat_role(role: str) -> str:
    normalized = str(role or "").strip().lower()
    if normalized in {"assistant", "ai", "bot", "model"}:
        return "assistant"
    if normalized == "system":
        return "system"
    return "user"


def build_messages(request: ChatRequest) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []
    system_prompt = str(request.system_prompt or "").strip()

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
    try:
        messages = build_messages(request)

        async def generate_response():
            try:
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
                    elif isinstance(chunk, str):
                        yield f"data: {json.dumps({'content': chunk})}\n\n"
                    else:
                        yield f"data: {json.dumps({'content': str(chunk)})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"

        return StreamingResponse(generate_response(), media_type="text/event-stream")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/history/save")
async def save_chat_history(session: SessionRequest):
    try:
        session_dict = {
            "title": session.title,
            "model": session.model,
            "messages": session.messages,
        }
        session_id = await chat_history_manager.save_session(session_dict)
        return {"success": True, "sessionId": session_id}
    except Exception as exc:
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
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/usage")
async def get_usage():
    try:
        settings = chat_history_manager.load_settings()
        token_limit = int(settings.get("monthlyTokenLimit", 200000))
        usage = await chat_history_manager.get_usage_summary(token_limit=token_limit)

        username = (
            os.environ.get("USERNAME")
            or os.environ.get("USER")
            or os.path.basename(os.path.expanduser("~"))
        )
        models_path = os.path.join(os.path.expanduser("~"), ".ollama", "models")

        return {
            "accountName": username,
            "plan": "Free",
            "messageCharLimit": 4000,
            "modelsPath": models_path,
            "sessionsPath": chat_history_manager.data_dir,
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
