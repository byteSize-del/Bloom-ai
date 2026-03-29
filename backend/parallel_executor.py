from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Set

from task_manager import TaskManager


SAFE_READ_ONLY_TOOLS: Set[str] = {
    "list_directory",
    "read_file",
    "search_files",
    "get_system_info",
    "get_running_processes",
    "read_clipboard",
    "get_environment",
}


class ParallelToolExecutor:
    _instance: Optional["ParallelToolExecutor"] = None

    def __init__(self) -> None:
        self._read_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._active_reads: Dict[str, asyncio.Task[Dict[str, Any]]] = {}
        self._semaphore = asyncio.Semaphore(5)
        self._task_manager = TaskManager.get_instance()

    @classmethod
    def get_instance(cls) -> "ParallelToolExecutor":
        if cls._instance is None:
            cls._instance = ParallelToolExecutor()
        return cls._instance

    def is_read_only_tool(self, tool_name: str) -> bool:
        return tool_name in SAFE_READ_ONLY_TOOLS

    async def execute_read(
        self,
        tool_name: str,
        params: Dict[str, Any],
        task_id: str,
    ) -> Dict[str, Any]:
        from agent_tools import execute_tool

        async with self._semaphore:
            await self._task_manager.append_output(
                task_id,
                f"[PARALLEL] Starting read-only tool: {tool_name}",
            )
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: execute_tool(tool_name, params),
            )
            await self._task_manager.append_output(
                task_id,
                f"[PARALLEL] Completed read-only tool: {tool_name}",
            )
            return result

    async def execute_write(
        self,
        tool_name: str,
        params: Dict[str, Any],
        task_id: str,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            from agent_tools import execute_tool

            await self._task_manager.append_output(
                task_id,
                f"[PARALLEL] Executing write tool (serialized): {tool_name}",
            )
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: execute_tool(tool_name, params),
            )
            await self._task_manager.append_output(
                task_id,
                f"[PARALLEL] Completed write tool: {tool_name}",
            )
            return result

    async def execute_batched_reads(
        self,
        calls: List[Dict[str, Any]],
        task_id: str,
    ) -> List[Dict[str, Any]]:
        tasks = [
            self.execute_read(call["tool"], call["params"], task_id)
            for call in calls
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [
            r if not isinstance(r, Exception) else {"error": str(r), "success": False}
            for r in results
        ]
