from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional

from agent_loop import AgentLoopController
from model_handler import OllamaHandler
from task_manager import SharedContext, TaskManager, TaskPriority, TaskStatus, TaskStep


class SubAgentRole(str, Enum):
    PLANNER = "planner"
    FILE = "file"
    SEARCH = "search"
    SHELL = "shell"
    TEST = "test"
    REVIEW = "review"


SUB_AGENT_ROLES = {
    SubAgentRole.PLANNER: {
        "system_prefix": "You are the Planner agent. Your job is to break down complex user requests into smaller, "
        "executable tasks. You decide which tasks can run in parallel and which depend on others. "
        "You spawn worker tasks via the task manager. Keep tasks focused and non-overlapping.",
        "default_model": "llama3",
    },
    SubAgentRole.FILE: {
        "system_prefix": "You are the File agent. Your job is to read, write, and organize files on the local machine. "
        "You handle project structure changes, create folders, and manage file content. "
        "Prefer safe read operations. Write operations require clear justification.",
        "default_model": "llama3",
    },
    SubAgentRole.SEARCH: {
        "system_prefix": "You are the Search agent. Your job is to search the codebase, find symbols, TODOs, errors, "
        "and references. You gather context quickly and report findings clearly to the task system.",
        "default_model": "llama3",
    },
    SubAgentRole.SHELL: {
        "system_prefix": "You are the Shell agent. Your job is to run safe shell commands for the user. "
        "You handle lint checks, build commands, dependency checks, and environment validation. "
        "Summarize command output clearly for the task system.",
        "default_model": "llama3",
    },
    SubAgentRole.TEST: {
        "system_prefix": "You are the Test agent. Your job is to run tests, summarize failures, "
        "and verify whether fixes actually worked. Report results clearly back to the task system.",
        "default_model": "llama3",
    },
    SubAgentRole.REVIEW: {
        "system_prefix": "You are the Review agent. You inspect results from other agents, catch regressions, "
        "missing tests, and risky edits. You act as a quality gate and provide clear feedback "
        "on what was done well and what needs improvement.",
        "default_model": "llama3",
    },
}


TOOL_LOOP_LIMIT = 4
TEXT_CHUNK_SIZE = 180
MAX_CONCURRENT_WORKERS = 3


@dataclass
class SubAgentStats:
    role: SubAgentRole
    task_id: str
    started_at: str = ""
    finished_at: Optional[str] = None
    steps_completed: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "role": self.role.value,
            "task_id": self.task_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "steps_completed": self.steps_completed,
            "last_error": self.last_error,
        }


class SubAgent:
    def __init__(
        self,
        goal: str,
        role: SubAgentRole,
        model: str,
        temperature: float,
        task_id: str,
        session_id: Optional[str] = None,
        mcp_manager=None,
    ) -> None:
        self.goal = goal
        self.role = role
        self.model = model
        self.temperature = temperature
        self.task_id = task_id
        self.session_id = session_id or uuid.uuid4().hex
        self.task_manager = TaskManager.get_instance()
        self.stats = SubAgentStats(role=role, task_id=task_id)
        self._messages: List[Dict[str, str]] = []
        self._cancelled = False
        self._paused = False

        role_config = SUB_AGENT_ROLES.get(role, SUB_AGENT_ROLES[SubAgentRole.FILE])
        self._system_prompt_base = role_config["system_prefix"]
        self._default_model = role_config["default_model"]

        self._ollama_handler = OllamaHandler()
        self._mcp_manager = mcp_manager
        self._agent_loop = AgentLoopController(self._ollama_handler, mcp_manager=mcp_manager)

    async def run(self) -> Dict[str, Any]:
        self.stats.started_at = datetime.now(timezone.utc).isoformat()
        await self.task_manager.mark_running(self.task_id)
        timeout = self.task_manager.get_task_timeout(self.task_id)
        await self.task_manager.append_output(self.task_id, f"[{self.role.value}] Starting agent for goal: {self.goal[:80]}")

        role_label = self.role.value.upper()
        system_prompt = self._build_system_prompt()

        try:
            async for event in self._run_loop(system_prompt):
                if self._cancelled:
                    await self.task_manager.fail_task(self.task_id, "Task was cancelled by user.")
                    return {"success": False, "error": "cancelled"}

                age = self.task_manager.get_task_age_seconds(self.task_id)
                if age > timeout:
                    await self.task_manager.fail_task(self.task_id, f"Task timed out after {timeout}s.")
                    return {"success": False, "error": "timeout"}

                event_type = event.get("type", "")

                if event_type == "thinking":
                    await self.task_manager.append_output(self.task_id, f"[{role_label}] {event.get('content', '')}")

                elif event_type == "content":
                    content = event.get("content", "")
                    if content:
                        await self.task_manager.append_output(self.task_id, f"[{role_label}] {content}")

                elif event_type == "tool_proposal":
                    await self.task_manager.append_output(
                        self.task_id,
                        f"[{role_label}] Tool proposed: {event.get('proposal', {}).get('tool', 'unknown')}",
                    )

                elif event_type == "tool_result":
                    result_status = event.get("status", "")
                    tool_name = event.get("tool", "")
                    result_data = event.get("result")
                    if result_status == "approved" and result_data:
                        is_mcp = event.get("is_mcp", False)
                        tag = " [MCP]" if is_mcp else ""
                        preview = str(result_data)[:200]
                        await self.task_manager.append_output(
                            self.task_id,
                            f"[{role_label}] {tool_name}{tag} → {preview}",
                        )
                    elif result_status == "denied":
                        await self.task_manager.append_output(self.task_id, f"[{role_label}] {tool_name} was denied.")

                elif event_type == "safety_block":
                    await self.task_manager.append_output(
                        self.task_id,
                        f"[{role_label}] BLOCKED: {event.get('content', 'unknown reason')}",
                    )

                elif event_type == "done":
                    await self.task_manager.append_output(self.task_id, f"[{role_label}] Completed.")
                    await self.task_manager.complete_task(self.task_id, {"final_message": event.get("content", "")})
                    self.stats.finished_at = datetime.now(timezone.utc).isoformat()
                    return {"success": True, "stats": self.stats.to_dict()}

        except asyncio.CancelledError:
            await self.task_manager.fail_task(self.task_id, "Task was cancelled.")
            self.stats.finished_at = datetime.now(timezone.utc).isoformat()
            return {"success": False, "error": "cancelled"}

        except Exception as exc:
            await self.task_manager.fail_task(self.task_id, str(exc))
            self.stats.last_error = str(exc)
            self.stats.finished_at = datetime.now(timezone.utc).isoformat()
            return {"success": False, "error": str(exc)}

        await self.task_manager.complete_task(self.task_id)
        self.stats.finished_at = datetime.now(timezone.utc).isoformat()
        return {"success": True, "stats": self.stats.to_dict()}

    async def _run_loop(self, system_prompt: str):
        messages = [{"role": "system", "content": system_prompt}]
        messages.append({"role": "user", "content": self.goal})
        last_summary = ""

        for step in range(TOOL_LOOP_LIMIT):
            if self._cancelled:
                break

            await self.task_manager.update_progress(self.task_id, (step / TOOL_LOOP_LIMIT))
            self.stats.steps_completed = step + 1

            thinking_msg = (
                f"[{self.role.value.upper()}] Planning step {step + 1}/{TOOL_LOOP_LIMIT}"
                if step == 0
                else f"[{self.role.value.upper()}] Reviewing result of step {step}"
            )
            yield {"type": "thinking", "content": thinking_msg}

            response_text = await self._ollama_handler.chat(
                model=self.model or self._default_model,
                messages=messages,
                temperature=self.temperature,
            )

            tool_call = self._agent_loop.extract_tool_call(response_text)
            if not tool_call:
                final_text = response_text or last_summary
                if final_text:
                    yield {"type": "content", "content": final_text}
                    last_summary = final_text
                yield {"type": "done", "content": final_text}
                return

            tool_name = str(tool_call.get("tool", "")).strip()
            params = dict(tool_call.get("params") or {})

            messages.append({"role": "assistant", "content": response_text})

            tool_meta = self._agent_loop._resolve_tool_meta(tool_name)
            if not tool_meta:
                block_msg = f"Tool '{tool_name}' is not registered."
                yield {"type": "safety_block", "tool": tool_name, "content": block_msg}
                messages.append({"role": "system", "content": block_msg})
                continue

            safe, reason = self._agent_loop._is_tool_safe(tool_name, params)
            if not safe:
                yield {"type": "safety_block", "tool": tool_name, "content": reason}
                messages.append({"role": "system", "content": reason})
                continue

            try:
                result = await self._agent_loop._execute_or_proxy(tool_name, params)
                is_mcp = str(tool_name).startswith("mcp:")
                from agent_tools import user_facing_tool_summary
                summary = user_facing_tool_summary(result)
                last_summary = summary
                messages.append(
                    {
                        "role": "system",
                        "content": f"Tool result: {summary}",
                    }
                )
                tag = " [MCP]" if is_mcp else ""
                yield {
                    "type": "tool_result",
                    "tool": tool_name,
                    "status": "approved",
                    "is_mcp": is_mcp,
                    "result": result,
                }
            except Exception as exc:
                error_msg = f"Tool execution failed: {exc}"
                yield {"type": "tool_result", "tool": tool_name, "status": "error", "content": error_msg}
                messages.append({"role": "system", "content": error_msg})

        if last_summary:
            yield {"type": "content", "content": last_summary}
        yield {"type": "done", "content": "Agent reached maximum steps."}

    def _build_system_prompt(self) -> str:
        return (
            f"{self._system_prompt_base}\n\n"
            "You must respond with a JSON tool call when performing local actions. "
            "Format: {\"tool\": \"tool_name\", \"params\": {\"key\": \"value\"}, \"reason\": \"why\"}. "
            "Do not execute without proposing first. "
            "After each tool result, continue reasoning until the task is complete."
        )

    def cancel(self) -> None:
        self._cancelled = True

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False


class SubAgentRunner:
    _instance: Optional["SubAgentRunner"] = None

    def __init__(self) -> None:
        self._task_manager = TaskManager.get_instance()
        self._active_agents: Dict[str, SubAgent] = {}
        self._max_workers = MAX_CONCURRENT_WORKERS
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "SubAgentRunner":
        if cls._instance is None:
            cls._instance = SubAgentRunner()
        return cls._instance

    async def spawn(
        self,
        goal: str,
        role: SubAgentRole,
        model: str = "llama3",
        temperature: float = 0.7,
        task_id: Optional[str] = None,
        mcp_manager=None,
    ) -> str:
        if task_id is None:
            task = await self._task_manager.submit(
                title=goal[:80],
                description=goal,
                role=self._map_role(role),
                model=model,
                temperature=temperature,
            )
            task_id = task.id
        else:
            task = await self._task_manager.get_task(task_id)
            if not task:
                raise ValueError(f"Task {task_id} not found")

        running_count = self._task_manager.get_running_count()
        if running_count >= self._max_workers:
            await self._task_manager.append_output(
                task_id,
                f"[RUNNER] Max workers ({self._max_workers}) reached. Task queued.",
            )

        agent = SubAgent(
            goal=goal,
            role=role,
            model=model,
            temperature=temperature,
            task_id=task_id,
            mcp_manager=mcp_manager,
        )
        self._active_agents[task_id] = agent

        asyncio.create_task(self._run_agent(agent))
        return task_id

    async def _run_agent(self, agent: SubAgent) -> None:
        await agent.run()
        self._active_agents.pop(agent.task_id, None)

    async def cancel(self, task_id: str) -> bool:
        agent = self._active_agents.get(task_id)
        if agent:
            agent.cancel()
        return await self._task_manager.cancel_task(task_id)

    def get_active_agent(self, task_id: str) -> Optional[SubAgent]:
        return self._active_agents.get(task_id)

    def _map_role(self, role: SubAgentRole) -> TaskStep:
        mapping = {
            SubAgentRole.PLANNER: TaskStep.PLANNER,
            SubAgentRole.FILE: TaskStep.FILE,
            SubAgentRole.SEARCH: TaskStep.SEARCH,
            SubAgentRole.SHELL: TaskStep.SHELL,
            SubAgentRole.TEST: TaskStep.TEST,
            SubAgentRole.REVIEW: TaskStep.REVIEW,
        }
        return mapping.get(role, TaskStep.PLANNER)

    @property
    def max_workers(self) -> int:
        return self._max_workers

    @max_workers.setter
    def max_workers(self, value: int) -> None:
        self._max_workers = max(1, min(value, 10))
