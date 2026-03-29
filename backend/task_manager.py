from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class TaskStep(str, Enum):
    PLANNER = "planner"
    FILE = "file"
    SHELL = "shell"
    SEARCH = "search"
    TEST = "test"
    REVIEW = "review"


class Task(BaseModel):
    id: str
    title: str
    description: str = ""
    priority: TaskPriority = TaskPriority.NORMAL
    status: TaskStatus = TaskStatus.PENDING
    created_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    progress: float = 0.0
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    parent_id: Optional[str] = None
    tags: List[str] = []
    role: TaskStep = TaskStep.PLANNER
    model: str = "llama3"
    temperature: float = 0.7
    steps: int = 0
    max_steps: int = 5
    output_logs: List[str] = []

    class Config:
        use_enum_values = True


class SharedContext:
    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}
        self._lock = asyncio.Lock()

    async def set(self, key: str, value: Any) -> None:
        async with self._lock:
            self._data[key] = value

    async def get(self, key: str, default: Any = None) -> Any:
        async with self._lock:
            return self._data.get(key, default)

    async def update(self, updates: Dict[str, Any]) -> None:
        async with self._lock:
            self._data.update(updates)

    async def get_all(self) -> Dict[str, Any]:
        async with self._lock:
            return dict(self._data)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)


class TaskManager:
    _instance: Optional["TaskManager"] = None
    _max_concurrent_tasks: int = 10
    _default_task_timeout: int = 600

    def __init__(self) -> None:
        self._tasks: Dict[str, Task] = {}
        self._lock = asyncio.Lock()
        self._event_handlers: Dict[str, List[Callable[[Dict[str, Any]], None]]] = {
            "task_status": [],
            "task_output": [],
            "task_progress": [],
            "task_error": [],
            "task_done": [],
        }
        self._shared_context = SharedContext()
        self._running_tasks: Dict[str, asyncio.Task[Any]] = {}
        self._task_start_time: Dict[str, float] = {}
        self._task_timeout: Dict[str, int] = {}
        self._write_locks: Dict[str, str] = {}
        self._duplicate_registry: Dict[str, float] = {}
        self._submitted_tasks: Dict[str, str] = {}

    @classmethod
    def get_instance(cls) -> "TaskManager":
        if cls._instance is None:
            cls._instance = TaskManager()
        return cls._instance

    async def submit(
        self,
        title: str,
        description: str = "",
        priority: TaskPriority = TaskPriority.NORMAL,
        parent_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        role: TaskStep = TaskStep.PLANNER,
        model: str = "llama3",
        temperature: float = 0.7,
        max_steps: int = 5,
        timeout: Optional[int] = None,
    ) -> Task:
        if self.get_running_count() >= self._max_concurrent_tasks:
            raise RuntimeError(f"Concurrent task limit ({self._max_concurrent_tasks}) reached. Wait for a task to finish.")

        dup_key = f"{role.value}:{title.strip()}"
        now = datetime.now(timezone.utc).timestamp()
        if dup_key in self._submitted_tasks:
            last = self._submitted_tasks[dup_key]
            if now - last < 30:
                raise RuntimeError(f"Duplicate task suppressed: '{title.strip()}' was submitted less than 30s ago.")

        task = Task(
            id=uuid.uuid4().hex,
            title=title,
            description=description,
            priority=priority,
            status=TaskStatus.PENDING,
            created_at=datetime.now(timezone.utc).isoformat(),
            parent_id=parent_id,
            tags=tags or [],
            role=role,
            model=model,
            temperature=temperature,
            max_steps=max_steps,
        )
        async with self._lock:
            self._tasks[task.id] = task
        self._submitted_tasks[dup_key] = now
        self._task_timeout[task.id] = timeout or self._default_task_timeout
        await self._emit("task_status", self._task_event(task, "submitted"))
        return task

    async def list_tasks(
        self,
        status: Optional[TaskStatus] = None,
        parent_id: Optional[str] = None,
    ) -> List[Task]:
        async with self._lock:
            tasks = list(self._tasks.values())
        if status is not None:
            tasks = [t for t in tasks if t.status == status]
        if parent_id is not None:
            tasks = [t for t in tasks if t.parent_id == parent_id]
        return sorted(tasks, key=lambda t: (t.priority != TaskPriority.URGENT, t.created_at))

    async def get_task(self, task_id: str) -> Optional[Task]:
        async with self._lock:
            return self._tasks.get(task_id)

    async def cancel_task(self, task_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            if task.status in (TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED):
                return False
            task.status = TaskStatus.CANCELLED
            task.finished_at = datetime.now(timezone.utc).isoformat()
        await self._emit("task_status", self._task_event(task, "cancelled"))
        running = self._running_tasks.get(task_id)
        if running and not running.done():
            running.cancel()
        return True

    async def pause_task(self, task_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task or task.status != TaskStatus.RUNNING:
                return False
            task.status = TaskStatus.PAUSED
        await self._emit("task_status", self._task_event(task, "paused"))
        return True

    async def resume_task(self, task_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task or task.status != TaskStatus.PAUSED:
                return False
            task.status = TaskStatus.RUNNING
        await self._emit("task_status", self._task_event(task, "resumed"))
        return True

    async def update_progress(self, task_id: str, progress: float, output: Optional[str] = None) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.progress = max(0.0, min(1.0, progress))
            if output:
                task.output_logs.append(output)
        await self._emit("task_progress", {
            "task_id": task_id,
            "progress": task.progress,
            "output": output,
        })

    async def append_output(self, task_id: str, line: str) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.output_logs.append(line)
        await self._emit("task_output", {"task_id": task_id, "line": line})

    async def complete_task(self, task_id: str, result: Optional[Dict[str, Any]] = None) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.status = TaskStatus.DONE
            task.finished_at = datetime.now(timezone.utc).isoformat()
            task.progress = 1.0
            task.result = result
        await self._emit("task_status", self._task_event(task, "completed"))
        await self._emit("task_done", {"task_id": task_id, "result": result})
        self._running_tasks.pop(task_id, None)

    async def fail_task(self, task_id: str, error: str) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.status = TaskStatus.FAILED
            task.finished_at = datetime.now(timezone.utc).isoformat()
            task.error = error
        await self._emit("task_status", self._task_event(task, "failed"))
        await self._emit("task_error", {"task_id": task_id, "error": error})
        self._running_tasks.pop(task_id, None)

    async def mark_running(self, task_id: str) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = TaskStatus.RUNNING
                task.started_at = datetime.now(timezone.utc).isoformat()
        self._task_start_time[task_id] = datetime.now(timezone.utc).timestamp()
        await self._emit("task_status", self._task_event(task, "started"))

    async def store_output_logs(self, task_id: str) -> List[str]:
        async with self._lock:
            task = self._tasks.get(task_id)
            return list(task.output_logs) if task else []

    def get_shared_context(self) -> SharedContext:
        return self._shared_context

    def on_event(self, event_type: str, handler: Callable[[Dict[str, Any]], None]) -> None:
        if event_type in self._event_handlers:
            self._event_handlers[event_type].append(handler)

    async def _emit(self, event_type: str, data: Dict[str, Any]) -> None:
        for handler in self._event_handlers.get(event_type, []):
            try:
                handler(data)
            except Exception:
                pass

    def _task_event(self, task: Task, action: str) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "action": action,
            "task": task.model_dump(),
        }

    def get_running_count(self) -> int:
        return len([t for t in self._tasks.values() if t.status == TaskStatus.RUNNING])

    def get_max_concurrent_tasks(self) -> int:
        return self._max_concurrent_tasks

    def set_max_concurrent_tasks(self, limit: int) -> None:
        self._max_concurrent_tasks = max(1, min(limit, 20))

    def get_task_timeout(self, task_id: str) -> int:
        return self._task_timeout.get(task_id, self._default_task_timeout)

    def get_task_age_seconds(self, task_id: str) -> float:
        start = self._task_start_time.get(task_id)
        if not start:
            return 0.0
        return datetime.now(timezone.utc).timestamp() - start

    async def acquire_file_lock(self, file_path: str, task_id: str) -> bool:
        normalized = str(Path(file_path).resolve())
        async with self._lock:
            owner = self._write_locks.get(normalized)
            if owner and owner != task_id:
                return False
            self._write_locks[normalized] = task_id
            return True

    async def release_file_lock(self, file_path: str, task_id: str) -> None:
        normalized = str(Path(file_path).resolve())
        async with self._lock:
            if self._write_locks.get(normalized) == task_id:
                del self._write_locks[normalized]

    def get_file_lock_owner(self, file_path: str) -> Optional[str]:
        normalized = str(Path(file_path).resolve())
        return self._write_locks.get(normalized)

    async def shutdown(self) -> None:
        for task_id, running_task in list(self._running_tasks.items()):
            if not running_task.done():
                running_task.cancel()
        self._running_tasks.clear()
        self._task_start_time.clear()
        self._task_timeout.clear()
        self._write_locks.clear()
        self._duplicate_registry.clear()
        self._submitted_tasks.clear()
