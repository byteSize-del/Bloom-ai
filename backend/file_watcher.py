from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import watchfiles


class BloomFileHandler:
    def __init__(
        self,
        watch_id: str,
        patterns: List[str],
        auto_task: bool,
        on_change: Callable[[Dict[str, Any]], None],
    ) -> None:
        self.watch_id = watch_id
        self._compiled: List[re.Pattern] = [re.compile(p) for p in patterns] if patterns else []
        self._auto_task = auto_task
        self._on_change = on_change
        self._debounce: Dict[str, asyncio.Task[None]] = {}
        self._loop = asyncio.get_event_loop()

    def _match(self, path: str) -> bool:
        if not self._compiled:
            return True
        for p in self._compiled:
            if p.search(path):
                return True
        return False

    def _emit(self, path: str, change_type: str) -> None:
        key = f"{change_type}:{path}"
        existing = self._debounce.pop(key, None)
        if existing and not existing.done():
            existing.cancel()

        async def debounced():
            await asyncio.sleep(0.5)
            self._debounce.pop(key, None)
            self._on_change({
                "watch_id": self.watch_id,
                "type": change_type,
                "path": path,
                "auto_task": self._auto_task,
            })

        self._debounce[key] = self._loop.create_task(debounced())

    def on_change(self, change: watchfiles.Change, path: str) -> None:
        if not self._match(path):
            return
        type_map = {
            watchfiles.Change.added: "created",
            watchfiles.Change.modified: "modified",
            watchfiles.Change.removed: "deleted",
        }
        self._emit(path, type_map.get(change, "modified"))


class FileWatch:
    def __init__(
        self,
        watch_id: str,
        path: str,
        patterns: List[str],
        auto_task: bool,
        on_change: Callable[[Dict[str, Any]], None],
    ) -> None:
        self.watch_id = watch_id
        self.path = path
        self.patterns = patterns
        self.auto_task = auto_task
        self._handler = BloomFileHandler(watch_id, patterns, auto_task, on_change)
        self._task: Optional[asyncio.Task[None]] = None
        self._stop_event = asyncio.Event()

    async def _run(self) -> None:
        try:
            async for changes in watchfiles.watch(self.path, stop_event=self._stop_event, raise_interrupt=False):
                for change, path in changes:
                    self._handler.on_change(change, path)
        except Exception:
            pass

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    def stop(self) -> None:
        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()


class FileWatcher:
    _instance: Optional["FileWatcher"] = None

    def __init__(self) -> None:
        self._watches: Dict[str, FileWatch] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "FileWatcher":
        if cls._instance is None:
            cls._instance = FileWatcher()
        return cls._instance

    async def add_watch(
        self,
        watch_id: str,
        path: str,
        patterns: Optional[List[str]] = None,
        auto_task: bool = False,
        on_change: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        watch_path = Path(path).resolve()
        if not watch_path.exists() or not watch_path.is_dir():
            raise FileNotFoundError(f"Path not found: {watch_path}")

        async with self._lock:
            if watch_id in self._watches:
                raise ValueError(f"Watch '{watch_id}' already exists")

            def make_handler(data: Dict[str, Any]) -> None:
                if on_change:
                    on_change(data)

            watch = FileWatch(
                watch_id=watch_id,
                path=str(watch_path),
                patterns=patterns or [],
                auto_task=auto_task,
                on_change=make_handler,
            )
            watch.start()
            self._watches[watch_id] = watch

        return {
            "watch_id": watch_id,
            "path": str(watch_path),
            "patterns": patterns or [],
            "auto_task": auto_task,
            "running": True,
        }

    async def remove_watch(self, watch_id: str) -> bool:
        async with self._lock:
            watch = self._watches.pop(watch_id, None)
        if watch:
            watch.stop()
            return True
        return False

    async def list_watches(self) -> List[Dict[str, Any]]:
        async with self._lock:
            return [
                {
                    "watch_id": w.watch_id,
                    "path": w.path,
                    "patterns": w.patterns,
                    "auto_task": w.auto_task,
                    "running": w._task is not None and not w._task.done(),
                }
                for w in self._watches.values()
            ]

    async def shutdown(self) -> None:
        for watch in list(self._watches.values()):
            watch.stop()
        self._watches.clear()
