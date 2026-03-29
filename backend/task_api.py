from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from sub_agent import SubAgentRole, SubAgentRunner
from task_manager import TaskManager, TaskPriority, TaskStatus, TaskStep


router = APIRouter(prefix="/tasks", tags=["tasks"])
fw_router = APIRouter(prefix="/tasks/watch", tags=["file-watcher"])


class SpawnRequest(BaseModel):
    goal: str
    role: str = "file"
    model: str = "llama3"
    temperature: float = 0.7
    max_steps: int = 5
    priority: str = "normal"


class TaskStatusResponse(BaseModel):
    id: str
    title: str
    status: str
    role: str
    progress: float
    created_at: str


class TaskListResponse(BaseModel):
    tasks: List[TaskStatusResponse]


class WatchAddRequest(BaseModel):
    watch_id: str
    path: str
    patterns: Optional[List[str]] = None
    auto_task: bool = False


class WebSocketManager:
    _instance: Optional["WebSocketManager"] = None

    def __init__(self) -> None:
        self._connections: Dict[str, List[WebSocket]] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "WebSocketManager":
        if cls._instance is None:
            cls._instance = WebSocketManager()
        return cls._instance

    async def broadcast(self, event_type: str, data: Dict[str, Any]) -> None:
        async with self._lock:
            connections = [
                ws for conns in self._connections.values() for ws in conns
            ]
        for websocket in connections:
            try:
                await websocket.send_json({"type": event_type, **data})
            except Exception:
                pass


ws_manager = WebSocketManager.get_instance()
task_manager = TaskManager.get_instance()
sub_agent_runner = SubAgentRunner.get_instance()

_mcp_manager: Optional[Any] = None
_file_watcher: Optional[Any] = None


def set_mcp_manager(mcp) -> None:
    global _mcp_manager
    _mcp_manager = mcp


def set_file_watcher(fw) -> None:
    global _file_watcher
    _file_watcher = fw


def _role_from_str(role: str) -> SubAgentRole:
    role_lower = role.lower().strip()
    mapping = {
        "planner": SubAgentRole.PLANNER,
        "file": SubAgentRole.FILE,
        "search": SubAgentRole.SEARCH,
        "shell": SubAgentRole.SHELL,
        "test": SubAgentRole.TEST,
        "review": SubAgentRole.REVIEW,
    }
    if role_lower not in mapping:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{role}'. Must be one of: {list(mapping.keys())}",
        )
    return mapping[role_lower]


def _priority_from_str(priority: str) -> TaskPriority:
    mapping = {
        "low": TaskPriority.LOW,
        "normal": TaskPriority.NORMAL,
        "high": TaskPriority.HIGH,
        "urgent": TaskPriority.URGENT,
    }
    p = priority.lower().strip()
    return mapping.get(p, TaskPriority.NORMAL)


@router.post("/spawn")
async def spawn_task(request: SpawnRequest) -> Dict[str, Any]:
    try:
        role = _role_from_str(request.role)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        task = await task_manager.submit(
            title=request.goal[:80],
            description=request.goal,
            priority=_priority_from_str(request.priority),
            role=TaskStep(role.value),
            model=request.model,
            temperature=request.temperature,
            max_steps=request.max_steps,
        )
        task_id = task.id

        await sub_agent_runner.spawn(
            goal=request.goal,
            role=role,
            model=request.model,
            temperature=request.temperature,
            task_id=task_id,
            mcp_manager=_mcp_manager,
        )

        return {
            "success": True,
            "task_id": task_id,
            "message": f"Task '{task.title}' spawned as {role.value}.",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("")
async def list_tasks(status: Optional[str] = None) -> TaskListResponse:
    task_status = None
    if status:
        try:
            task_status = TaskStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {[s.value for s in TaskStatus]}",
            )

    tasks = await task_manager.list_tasks(status=task_status)
    return TaskListResponse(
        tasks=[
            TaskStatusResponse(
                id=t.id,
                title=t.title,
                status=t.status.value,
                role=t.role.value,
                progress=t.progress,
                created_at=t.created_at,
            )
            for t in tasks
        ]
    )


@router.get("/{task_id}")
async def get_task(task_id: str) -> Dict[str, Any]:
    task = await task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    logs = await task_manager.store_output_logs(task_id)
    return {
        "task": {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "priority": task.priority.value,
            "status": task.status.value,
            "role": task.role.value,
            "model": task.model,
            "progress": task.progress,
            "error": task.error,
            "result": task.result,
            "created_at": task.created_at,
            "started_at": task.started_at,
            "finished_at": task.finished_at,
            "output_logs": logs,
        }
    }


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str) -> Dict[str, Any]:
    success = await sub_agent_runner.cancel(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or cannot be cancelled")
    return {"success": True, "message": "Task cancelled"}


@router.post("/{task_id}/pause")
async def pause_task(task_id: str) -> Dict[str, Any]:
    success = await task_manager.pause_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task cannot be paused (must be running)")
    return {"success": True, "message": "Task paused"}


@router.post("/{task_id}/resume")
async def resume_task(task_id: str) -> Dict[str, Any]:
    success = await task_manager.resume_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task cannot be resumed (must be paused)")
    return {"success": True, "message": "Task resumed"}


@router.get("/{task_id}/logs")
async def get_task_logs(task_id: str) -> Dict[str, Any]:
    task = await task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    logs = await task_manager.store_output_logs(task_id)
    return {"task_id": task_id, "logs": logs}


@router.websocket("/ws")
async def task_websocket(websocket: WebSocket, client_id: str = "default"):
    await websocket.accept()

    async def forward_event(event_type: str, data: Dict[str, Any]) -> None:
        try:
            await websocket.send_json({"type": event_type, **data})
        except Exception:
            pass

    task_manager.on_event("task_status", lambda d: forward_event("task_status", d))
    task_manager.on_event("task_output", lambda d: forward_event("task_output", d))
    task_manager.on_event("task_progress", lambda d: forward_event("task_progress", d))
    task_manager.on_event("task_error", lambda d: forward_event("task_error", d))
    task_manager.on_event("task_done", lambda d: forward_event("task_done", d))

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass


# ─── File Watcher Endpoints ───────────────────────────────────────────────────


@fw_router.post("/add")
async def add_watch(request: WatchAddRequest) -> Dict[str, Any]:
    if _file_watcher is None:
        raise HTTPException(status_code=503, detail="File watcher is not available")

    async def on_change(data: Dict[str, Any]) -> None:
        await ws_manager.broadcast("file_change", data)

    result = await _file_watcher.add_watch(
        watch_id=request.watch_id,
        path=request.path,
        patterns=request.patterns,
        auto_task=request.auto_task,
        on_change=on_change,
    )
    return {"success": True, "watch": result}


@fw_router.delete("/{watch_id}")
async def remove_watch(watch_id: str) -> Dict[str, Any]:
    if _file_watcher is None:
        raise HTTPException(status_code=503, detail="File watcher is not available")
    removed = await _file_watcher.remove_watch(watch_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Watch not found")
    return {"success": True, "message": f"Watch '{watch_id}' removed"}


@fw_router.get("")
async def list_watches() -> Dict[str, Any]:
    if _file_watcher is None:
        raise HTTPException(status_code=503, detail="File watcher is not available")
    watches = await _file_watcher.list_watches()
    return {"watches": watches}
