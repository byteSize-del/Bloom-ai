from __future__ import annotations

import asyncio
import json
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from agent_tools import BLOCKED_COMMANDS, BLOCKED_PATHS, MAX_FILE_SIZE_WRITE

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.sse import sse_client
    from mcp.client.stdio import stdio_client

    MCP_SDK_AVAILABLE = True
    MCP_IMPORT_ERROR = ""
except Exception as exc:  # pragma: no cover - depends on runtime env
    ClientSession = None
    StdioServerParameters = None
    stdio_client = None
    sse_client = None
    MCP_SDK_AVAILABLE = False
    MCP_IMPORT_ERROR = str(exc)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_to_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_to_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _to_json_safe(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        return _to_json_safe(value.model_dump())
    if hasattr(value, "dict"):
        return _to_json_safe(value.dict())
    if hasattr(value, "__dict__"):
        return _to_json_safe(vars(value))
    return str(value)


def _extract_tools_payload(payload: Any) -> List[Dict[str, Any]]:
    if payload is None:
        return []

    raw_tools = None
    if isinstance(payload, dict):
        raw_tools = payload.get("tools", [])
    elif hasattr(payload, "tools"):
        raw_tools = getattr(payload, "tools")
    else:
        raw_tools = payload

    tools: List[Dict[str, Any]] = []
    for tool in list(raw_tools or []):
        if isinstance(tool, dict):
            name = str(tool.get("name", "")).strip()
            if not name:
                continue
            tools.append(
                {
                    "name": name,
                    "description": str(tool.get("description", "")).strip(),
                    "inputSchema": _to_json_safe(tool.get("inputSchema") or tool.get("input_schema") or {}),
                }
            )
            continue

        name = str(getattr(tool, "name", "")).strip()
        if not name:
            continue
        tools.append(
            {
                "name": name,
                "description": str(getattr(tool, "description", "")).strip(),
                "inputSchema": _to_json_safe(getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None) or {}),
            }
        )
    return tools


def _normalize_server_config(raw_server: Dict[str, Any], index: int) -> Dict[str, Any]:
    transport = str(raw_server.get("transport", "stdio")).strip().lower()
    if transport not in {"stdio", "sse"}:
        transport = "stdio"

    name = str(raw_server.get("name", f"mcp-{index + 1}")).strip() or f"mcp-{index + 1}"
    server_id = str(raw_server.get("id") or f"{name}-{index + 1}").strip() or f"{name}-{index + 1}"

    args = raw_server.get("args", [])
    if isinstance(args, str):
        args = [item for item in args.split(" ") if item.strip()]
    if not isinstance(args, list):
        args = []
    args = [str(item) for item in args]

    env = raw_server.get("env", {})
    if not isinstance(env, dict):
        env = {}

    return {
        "id": server_id,
        "name": name,
        "enabled": bool(raw_server.get("enabled", True)),
        "transport": transport,
        "command": str(raw_server.get("command", "")).strip(),
        "args": args,
        "env": {str(key): str(value) for key, value in env.items()},
        "url": str(raw_server.get("url", "")).strip(),
        "description": str(raw_server.get("description", "")).strip(),
        "autoConnect": bool(raw_server.get("autoConnect", True)),
    }


def _iter_string_values(value: Any):
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, dict):
        for item in value.values():
            yield from _iter_string_values(item)
        return
    if isinstance(value, list):
        for item in value:
            yield from _iter_string_values(item)
        return
    if isinstance(value, tuple):
        for item in value:
            yield from _iter_string_values(item)


class MCPServerConnection:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.server_id = config["id"]
        self.name = config["name"]

        self._stack: Optional[AsyncExitStack] = None
        self._session: Any = None
        self.tools: List[Dict[str, Any]] = []

        self.status: str = "disconnected"
        self.error: str = ""
        self.last_connected_at: str = ""
        self.last_checked_at: str = ""

    def update_config(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.server_id = config["id"]
        self.name = config["name"]

    def is_connected(self) -> bool:
        return self.status == "connected" and self._session is not None

    async def connect(self) -> None:
        self.last_checked_at = _utc_now_iso()
        self.error = ""

        if not self.config.get("enabled", True):
            self.status = "disabled"
            return

        if not MCP_SDK_AVAILABLE:
            self.status = "error"
            self.error = f"MCP Python SDK is unavailable: {MCP_IMPORT_ERROR or 'unknown import error'}"
            return

        await self.disconnect()

        try:
            self._stack = AsyncExitStack()
            transport = self.config.get("transport", "stdio")
            if transport == "sse":
                url = str(self.config.get("url", "")).strip()
                if not url:
                    raise ValueError("SSE transport requires a URL.")
                read_stream, write_stream = await self._stack.enter_async_context(sse_client(url))
            else:
                command = str(self.config.get("command", "")).strip()
                if not command:
                    raise ValueError("Stdio transport requires a command.")
                args = list(self.config.get("args", []) or [])
                env = dict(self.config.get("env", {}) or {})
                server_params = StdioServerParameters(command=command, args=args, env=env or None)
                read_stream, write_stream = await self._stack.enter_async_context(stdio_client(server_params))

            self._session = await self._stack.enter_async_context(ClientSession(read_stream, write_stream))
            await self._session.initialize()
            await self.refresh_tools()
            self.status = "connected"
            self.last_connected_at = _utc_now_iso()
            self.error = ""
        except Exception as exc:
            self.status = "error"
            self.error = str(exc)
            await self.disconnect()
            self.status = "error"
            if not self.error:
                self.error = str(exc)

    async def disconnect(self) -> None:
        if self._stack is not None:
            try:
                await self._stack.aclose()
            except Exception:
                pass
        self._stack = None
        self._session = None
        self.tools = []
        if self.status not in {"disabled", "error"}:
            self.status = "disconnected"

    async def refresh_tools(self) -> None:
        if self._session is None:
            self.tools = []
            return
        payload = await self._session.list_tools()
        self.tools = _extract_tools_payload(payload)

    async def call_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if self._session is None:
            raise RuntimeError(f"MCP server '{self.name}' is not connected.")

        try:
            payload = await self._session.call_tool(tool_name, params or {})
        except TypeError:
            payload = await self._session.call_tool(tool_name, arguments=params or {})

        safe_payload = _to_json_safe(payload)
        return {
            "tool": f"mcp:{self.name}:{tool_name}",
            "serverId": self.server_id,
            "serverName": self.name,
            "transport": self.config.get("transport", "stdio"),
            "result": safe_payload,
            "timestamp": _utc_now_iso(),
        }

    def status_entry(self) -> Dict[str, Any]:
        return {
            "id": self.server_id,
            "name": self.name,
            "enabled": bool(self.config.get("enabled", True)),
            "transport": self.config.get("transport", "stdio"),
            "description": self.config.get("description", ""),
            "status": self.status,
            "error": self.error,
            "toolCount": len(self.tools),
            "tools": list(self.tools),
            "command": self.config.get("command", ""),
            "args": list(self.config.get("args", []) or []),
            "url": self.config.get("url", ""),
            "autoConnect": bool(self.config.get("autoConnect", True)),
            "lastConnectedAt": self.last_connected_at,
            "lastCheckedAt": self.last_checked_at,
        }


class MCPManager:
    def __init__(self) -> None:
        self._connections: Dict[str, MCPServerConnection] = {}
        self._lock = asyncio.Lock()

    @property
    def is_available(self) -> bool:
        return MCP_SDK_AVAILABLE

    @property
    def import_error(self) -> str:
        return MCP_IMPORT_ERROR

    def _normalized_servers(self, settings: Dict[str, Any]) -> List[Dict[str, Any]]:
        raw = settings.get("mcpServers", []) if isinstance(settings, dict) else []
        if not isinstance(raw, list):
            return []
        normalized: List[Dict[str, Any]] = []
        for index, server in enumerate(raw):
            if isinstance(server, dict):
                normalized.append(_normalize_server_config(server, index))
        return normalized

    async def refresh_all(self, settings: Dict[str, Any]) -> None:
        async with self._lock:
            server_configs = self._normalized_servers(settings)
            keep_ids = {config["id"] for config in server_configs}

            to_remove = [server_id for server_id in self._connections.keys() if server_id not in keep_ids]
            for server_id in to_remove:
                connection = self._connections.pop(server_id)
                await connection.disconnect()

            for config in server_configs:
                connection = self._connections.get(config["id"])
                if connection is None:
                    connection = MCPServerConnection(config)
                    self._connections[config["id"]] = connection
                else:
                    connection.update_config(config)

                if config.get("enabled", True) and config.get("autoConnect", True):
                    await connection.connect()
                else:
                    await connection.disconnect()
                    connection.status = "disabled" if not config.get("enabled", True) else "idle"

    async def shutdown(self) -> None:
        async with self._lock:
            for connection in list(self._connections.values()):
                await connection.disconnect()
            self._connections.clear()

    async def connect_server(self, config: Dict[str, Any]) -> Dict[str, Any]:
        normalized = _normalize_server_config(config, 0)
        async with self._lock:
            connection = self._connections.get(normalized["id"])
            if connection is None:
                connection = MCPServerConnection(normalized)
                self._connections[normalized["id"]] = connection
            else:
                connection.update_config(normalized)
            await connection.connect()
            return connection.status_entry()

    async def disconnect_server(self, server_id: str) -> None:
        async with self._lock:
            connection = self._connections.get(server_id)
            if connection is None:
                return
            await connection.disconnect()
            connection.status = "disconnected"

    async def reconnect_server(self, server_id: str) -> Dict[str, Any]:
        async with self._lock:
            connection = self._connections.get(server_id)
            if connection is None:
                raise KeyError("MCP server not found")
            await connection.connect()
            return connection.status_entry()

    async def test_server(self, server_id: str) -> Dict[str, Any]:
        status = await self.reconnect_server(server_id)
        return {
            "server": status,
            "ok": status.get("status") == "connected",
            "timestamp": _utc_now_iso(),
        }

    def _resolve_connection_for_tool(self, full_tool_name: str) -> Tuple[Optional[MCPServerConnection], str]:
        name = str(full_tool_name or "").strip()
        if not name.startswith("mcp:"):
            return None, ""

        parts = name.split(":", 2)
        if len(parts) != 3:
            return None, ""

        server_hint = parts[1].strip()
        tool_name = parts[2].strip()
        if not server_hint or not tool_name:
            return None, ""

        connection = self._connections.get(server_hint)
        if connection:
            return connection, tool_name

        for candidate in self._connections.values():
            if candidate.name == server_hint:
                return candidate, tool_name
        return None, tool_name

    async def call_tool_by_full_name(self, full_tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        connection, tool_name = self._resolve_connection_for_tool(full_tool_name)
        if connection is None:
            raise KeyError(f"MCP tool is not registered: {full_tool_name}")
        if not connection.is_connected():
            await connection.connect()
        return await connection.call_tool(tool_name, params)

    def get_tool_metadata(self, full_tool_name: str) -> Optional[Dict[str, Any]]:
        connection, tool_name = self._resolve_connection_for_tool(full_tool_name)
        if connection is None:
            return None

        for tool in connection.tools:
            if str(tool.get("name", "")).strip() == tool_name:
                return {
                    "name": full_tool_name,
                    "description": str(tool.get("description", "")).strip() or f"MCP tool {tool_name}",
                    "permission_tier": 2,
                    "risk": "medium",
                    "parameters": _to_json_safe(tool.get("inputSchema") or {}),
                    "requires_user_approval": True,
                    "source": "mcp",
                    "serverId": connection.server_id,
                    "serverName": connection.name,
                }
        return None

    def get_all_tools(self) -> List[Dict[str, Any]]:
        tools: List[Dict[str, Any]] = []
        for connection in self._connections.values():
            if not connection.is_connected():
                continue
            for tool in connection.tools:
                name = str(tool.get("name", "")).strip()
                if not name:
                    continue
                namespaced = f"mcp:{connection.name}:{name}"
                tools.append(
                    {
                        "name": namespaced,
                        "description": str(tool.get("description", "")).strip(),
                        "permission_tier": 2,
                        "risk": "medium",
                        "parameters": _to_json_safe(tool.get("inputSchema") or {}),
                        "requires_user_approval": True,
                        "source": "mcp",
                        "serverId": connection.server_id,
                        "serverName": connection.name,
                    }
                )
        return tools

    def get_status(self) -> List[Dict[str, Any]]:
        entries = [connection.status_entry() for connection in self._connections.values()]
        entries.sort(key=lambda item: str(item.get("name", "")).lower())
        return entries

    def is_safe_tool_call(self, full_tool_name: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        if not str(full_tool_name or "").startswith("mcp:"):
            return False, "This action was blocked because the tool is not in the MCP namespace."

        params_obj = dict(params or {})
        for key, value in params_obj.items():
            key_lower = str(key).strip().lower()
            if key_lower in {"content", "text", "body"}:
                size_bytes = len(str(value).encode("utf-8"))
                if size_bytes > MAX_FILE_SIZE_WRITE:
                    return False, "This action was blocked because the payload is larger than Bloom's safe write limit."

        for text in _iter_string_values(params_obj):
            candidate = str(text or "").strip()
            if not candidate:
                continue
            lower = candidate.lower()

            if any(blocked in lower for blocked in BLOCKED_COMMANDS):
                return False, "This action was blocked because the request contains a blocked command pattern."

            if ":\\" in candidate or candidate.startswith("\\\\"):
                for blocked_path in BLOCKED_PATHS:
                    blocked = blocked_path.lower().rstrip("\\")
                    current = lower.rstrip("\\")
                    if current == blocked or current.startswith(blocked + "\\"):
                        return False, "This action was blocked because it targets a protected Windows or system path."

        return True, ""

