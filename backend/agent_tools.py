from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

BLOCKED_PATHS = [
    r"C:\Windows\System32",
    r"C:\Windows\SysWOW64",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\ProgramData",
    r"HKEY_LOCAL_MACHINE",
    r"registry:",
]

BLOCKED_COMMANDS = [
    "format",
    "del /f /s /q c:\\",
    "rm -rf",
    "shutdown",
    "taskkill /f /im",
    "reg delete",
    "bcdedit",
    "diskpart",
]

MAX_FILE_SIZE_WRITE = 10 * 1024 * 1024
MAX_SHELL_TIMEOUT = 30
READ_ONLY_COMMAND_PREFIXES = (
    "dir",
    "ls",
    "ipconfig",
    "whoami",
    "echo",
    "type",
    "cat",
    "tasklist",
    "systeminfo",
)

APP_LAUNCHERS = {
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "browser": ["cmd.exe", "/c", "start", ""],
    "chrome": ["cmd.exe", "/c", "start", "chrome"],
    "vscode": ["code"],
    "explorer": ["explorer.exe"],
    "paint": ["mspaint.exe"],
    "taskmgr": ["taskmgr.exe"],
    "spotify": ["spotify"],
    "discord": ["discord"],
    "word": ["winword"],
    "excel": ["excel"],
    "settings": ["cmd.exe", "/c", "start", "ms-settings:"],
}

AGENT_TOOLS: Dict[str, Dict[str, Any]] = {
    "open_app": {
        "name": "open_app",
        "description": "Open a desktop application for the user.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {
            "app": {"type": "string", "description": "Application id such as notepad, vscode, chrome"}
        },
        "blocked_paths": [],
        "requires_user_approval": False,
    },
    "read_file": {
        "name": "read_file",
        "description": "Read text from a file on disk.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {
            "path": {"type": "string", "description": "Absolute file path"},
            "start_line": {"type": "integer", "description": "1-based line number to start from"},
            "end_line": {"type": "integer", "description": "1-based line number to end at"},
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": False,
    },
    "list_directory": {
        "name": "list_directory",
        "description": "List files and folders in a directory.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {
            "path": {"type": "string", "description": "Absolute directory path"}
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": False,
    },
    "get_system_info": {
        "name": "get_system_info",
        "description": "Read hardware and operating system information.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {},
        "blocked_paths": [],
        "requires_user_approval": False,
    },
    "get_running_processes": {
        "name": "get_running_processes",
        "description": "List currently running processes.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {},
        "blocked_paths": [],
        "requires_user_approval": False,
    },
    "read_clipboard": {
        "name": "read_clipboard",
        "description": "Read the current clipboard contents.",
        "permission_tier": 1,
        "risk": "low",
        "parameters": {},
        "blocked_paths": [],
        "requires_user_approval": False,
    },
    "write_file": {
        "name": "write_file",
        "description": "Write text content to a file on disk.",
        "permission_tier": 2,
        "risk": "low",
        "parameters": {
            "path": {"type": "string", "description": "Absolute file path"},
            "content": {"type": "string", "description": "Text to write"},
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": True,
    },
    "create_directory": {
        "name": "create_directory",
        "description": "Create a new directory on disk.",
        "permission_tier": 2,
        "risk": "low",
        "parameters": {
            "path": {"type": "string", "description": "Absolute directory path"}
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": True,
    },
    "search_files": {
        "name": "search_files",
        "description": "Search the local filesystem for matching file names.",
        "permission_tier": 2,
        "risk": "low",
        "parameters": {
            "query": {"type": "string", "description": "File name or keyword to search for"},
            "path": {"type": "string", "description": "Absolute directory to search inside"},
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": True,
    },
    "write_clipboard": {
        "name": "write_clipboard",
        "description": "Replace the clipboard contents with new text.",
        "permission_tier": 2,
        "risk": "medium",
        "parameters": {
            "text": {"type": "string", "description": "Clipboard text"}
        },
        "blocked_paths": [],
        "requires_user_approval": True,
    },
    "run_shell_command": {
        "name": "run_shell_command",
        "description": "Run a terminal command on the local machine.",
        "permission_tier": 3,
        "risk": "high",
        "parameters": {
            "command": {"type": "string", "description": "Command line to run"}
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": True,
    },
    "delete_file": {
        "name": "delete_file",
        "description": "Delete a file from disk.",
        "permission_tier": 3,
        "risk": "high",
        "parameters": {
            "path": {"type": "string", "description": "Absolute file path"}
        },
        "blocked_paths": BLOCKED_PATHS,
        "requires_user_approval": True,
    },
    "kill_process": {
        "name": "kill_process",
        "description": "Terminate a running process by PID.",
        "permission_tier": 3,
        "risk": "high",
        "parameters": {
            "pid": {"type": "integer", "description": "Process id to stop"}
        },
        "blocked_paths": [],
        "requires_user_approval": True,
    },
    "open_url": {
        "name": "open_url",
        "description": "Open a URL in the default browser.",
        "permission_tier": 2,
        "risk": "medium",
        "parameters": {
            "url": {"type": "string", "description": "Fully-qualified http or https URL"}
        },
        "blocked_paths": [],
        "requires_user_approval": True,
    },
}


def normalize_path(raw_path: Any) -> Path:
    path_text = str(raw_path or "").strip().strip('"').strip("'")
    if not path_text:
        raise FileNotFoundError("Path is required.")
    return Path(path_text).expanduser().resolve(strict=False)


def registry_json() -> str:
    return json.dumps(list(AGENT_TOOLS.values()), indent=2)


def is_path_blocked(path_value: str) -> bool:
    candidate = str(path_value or "").lower().rstrip("\\")
    return any(
        candidate == blocked.lower().rstrip("\\")
        or candidate.startswith(blocked.lower().rstrip("\\") + "\\")
        for blocked in BLOCKED_PATHS
    )


def is_blocked_command(command: str) -> bool:
    normalized = str(command or "").strip().lower()
    return any(blocked in normalized for blocked in BLOCKED_COMMANDS)


def is_read_only_command(command: str) -> bool:
    normalized = str(command or "").strip().lower()
    return normalized.startswith(READ_ONLY_COMMAND_PREFIXES) and not any(
        token in normalized
        for token in (
            ">",
            "del ",
            "erase ",
            "move ",
            "copy ",
            "ren ",
            "mkdir ",
            "rmdir ",
            "remove-item",
            "set-content",
            "out-file",
        )
    )


def effective_permission_tier(tool_name: str, params: Dict[str, Any]) -> int:
    base = int(AGENT_TOOLS.get(tool_name, {}).get("permission_tier", 3))
    if tool_name == "run_shell_command" and is_read_only_command(str(params.get("command", ""))):
        return 2
    return base


def is_safe(tool_name: str, params: Dict[str, Any]) -> Tuple[bool, str]:
    tool = AGENT_TOOLS.get(tool_name)
    if not tool:
        return False, "This tool is not registered in Bloom."

    if tool_name == "open_app":
        app_id = str(params.get("app", "")).strip().lower()
        if app_id not in APP_LAUNCHERS:
            return False, "This action was blocked because Bloom only opens a small allowlist of standard apps."

    for field in ("path",):
        if field in params and params[field]:
            try:
                candidate = normalize_path(params[field])
            except Exception:
                continue
            if is_path_blocked(str(candidate)):
                return False, "This action was blocked because it targets a protected Windows or system path."

    if tool_name == "write_file":
        content = str(params.get("content", ""))
        if len(content.encode("utf-8")) > MAX_FILE_SIZE_WRITE:
            return False, "This action was blocked because the file is larger than Bloom's safe write limit."

    if tool_name == "run_shell_command":
        command = str(params.get("command", ""))
        if not command:
            return False, "This action was blocked because no terminal command was provided."
        if is_blocked_command(command):
            return False, "This action was blocked because the command could damage the system."

    if tool_name == "open_url":
        url = str(params.get("url", ""))
        if not url.lower().startswith(("http://", "https://")):
            return False, "This action was blocked because only http and https links are allowed."

    return True, ""


def risk_badge(risk: str) -> str:
    normalized = str(risk or "medium").lower()
    return {
        "low": "Low",
        "medium": "Medium",
        "high": "High",
        "critical": "Critical",
    }.get(normalized, "Medium")


def summarize_tool_request(tool_name: str, params: Dict[str, Any]) -> str:
    if tool_name == "open_app":
        app_id = str(params.get("app", "app")).strip().lower() or "app"
        return f"Open {app_id} for the user"
    if tool_name == "read_file":
        return f"Read text from {params.get('path', 'the selected file')}"
    if tool_name == "list_directory":
        return f"List files inside {params.get('path', 'the selected folder')}"
    if tool_name == "write_file":
        return f"Create or update a file at {params.get('path', 'the target path')}"
    if tool_name == "create_directory":
        return f"Create a folder at {params.get('path', 'the target path')}"
    if tool_name == "search_files":
        return f"Search for files matching '{params.get('query', '')}'"
    if tool_name == "write_clipboard":
        return "Replace the clipboard contents"
    if tool_name == "run_shell_command":
        return "Run a terminal command"
    if tool_name == "delete_file":
        return f"Delete {params.get('path', 'the selected file')}"
    if tool_name == "kill_process":
        return f"Close the process with PID {params.get('pid', '?')}"
    if tool_name == "open_url":
        return f"Open {params.get('url', 'the link')} in the browser"
    if tool_name == "get_system_info":
        return "Read hardware and operating system details"
    if tool_name == "get_running_processes":
        return "List the apps currently running"
    if tool_name == "read_clipboard":
        return "Read the current clipboard"
    return AGENT_TOOLS.get(tool_name, {}).get("description", tool_name.replace("_", " ").title())


def format_tool_command(tool_name: str, params: Dict[str, Any]) -> str:
    return f'{tool_name}({json.dumps(params, ensure_ascii=False)})'


def audit_params_preview(tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    preview: Dict[str, Any] = {}
    for key, value in dict(params or {}).items():
        if key == "content":
            text = str(value)
            preview["content_preview"] = text[:240]
            preview["content_length"] = len(text.encode("utf-8"))
        elif key == "text":
            preview["text_preview"] = str(value)[:240]
        else:
            preview[key] = value
    preview["tool"] = tool_name
    return preview


def preview_result(result: Dict[str, Any]) -> str:
    text = json.dumps(result, ensure_ascii=False)
    return text[:320]


def model_observation_from_result(result: Dict[str, Any]) -> str:
    safe_payload = json.dumps(result, ensure_ascii=False, indent=2)
    return f"TOOL RESULT\n{safe_payload}\nUse this result to continue helping the user."


def user_facing_tool_summary(result: Dict[str, Any]) -> str:
    tool_name = str(result.get("tool", "")).strip()
    if tool_name.startswith("mcp:"):
        server_name = str(result.get("serverName", "MCP server")).strip()
        return f"I completed the requested action through {server_name}."

    if tool_name == "write_file":
        return f"I created or updated `{result.get('path', 'the file')}` successfully."
    if tool_name == "create_directory":
        return f"I created the folder `{result.get('path', 'the folder')}` successfully."
    if tool_name == "read_file":
        return (
            f"I read `{result.get('path', 'the file')}`"
            f" (lines {result.get('startLine', '?')}-{result.get('endLine', '?')})."
        )
    if tool_name == "list_directory":
        count = len(result.get("entries", []) or [])
        return f"I listed {count} item(s) in `{result.get('path', 'the folder')}`."
    if tool_name == "open_app":
        return str(result.get("result", "I opened the requested app successfully."))
    if tool_name == "get_system_info":
        return "I checked your system information successfully."
    if tool_name == "get_running_processes":
        return "I fetched the list of running processes successfully."
    if tool_name == "read_clipboard":
        return "I read the current clipboard contents."
    if tool_name == "write_clipboard":
        return "I updated the clipboard successfully."
    if tool_name == "run_shell_command":
        command = result.get("command", "the command")
        code = result.get("exitCode", 0)
        return f"I ran `{command}` and it finished with exit code {code}."
    if tool_name == "delete_file":
        return f"I deleted `{result.get('path', 'the target')}` successfully."
    if tool_name == "kill_process":
        return f"I attempted to close the process with PID {result.get('pid', '?')}."
    if tool_name == "open_url":
        return f"I opened `{result.get('url', 'the link')}` in your browser."
    if tool_name == "search_files":
        count = len(result.get("results", []) or [])
        return f"I found {count} matching file(s) for `{result.get('query', '')}`."

    return "The requested action completed successfully."


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _windows_memory_info() -> Dict[str, Any]:
    if os.name != "nt":
        return {}

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MEMORYSTATUSEX()
    status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return {
        "totalRamBytes": int(status.ullTotalPhys),
        "availableRamBytes": int(status.ullAvailPhys),
    }


def _run_powershell(command: str) -> str:
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=MAX_SHELL_TIMEOUT,
        check=False,
    )
    return (completed.stdout or completed.stderr or "").strip()


def execute_tool(tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    safe, reason = is_safe(tool_name, params)
    if not safe:
        raise PermissionError(reason)

    if tool_name == "open_app":
        app_id = str(params.get("app", "")).strip().lower()
        command = APP_LAUNCHERS.get(app_id)
        if not command:
            raise PermissionError(f"Bloom cannot open '{app_id}' from agent mode.")
        subprocess.Popen(command, shell=False)
        return {"tool": tool_name, "result": f"Opened {app_id}.", "timestamp": _now_iso()}

    if tool_name == "read_file":
        file_path = normalize_path(params.get("path"))
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f"File not found: {file_path}")
        raw_lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        start_line = max(1, int(params.get("start_line", 1) or 1))
        end_line = max(start_line, int(params.get("end_line", start_line + 199) or (start_line + 199)))
        excerpt = raw_lines[start_line - 1:end_line]
        return {
            "tool": tool_name,
            "path": str(file_path),
            "startLine": start_line,
            "endLine": min(end_line, len(raw_lines)),
            "content": "\n".join(excerpt),
            "timestamp": _now_iso(),
        }

    if tool_name == "list_directory":
        directory = normalize_path(params.get("path"))
        if not directory.exists() or not directory.is_dir():
            raise FileNotFoundError(f"Directory not found: {directory}")
        entries = []
        for item in sorted(directory.iterdir(), key=lambda value: (not value.is_dir(), value.name.lower()))[:150]:
            entries.append({
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            })
        return {"tool": tool_name, "path": str(directory), "entries": entries, "timestamp": _now_iso()}

    if tool_name == "get_system_info":
        memory = _windows_memory_info()
        disk = shutil.disk_usage(Path.home().anchor or str(Path.home()))
        gpu_info = _run_powershell(
            "(Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress)"
        )
        return {
            "tool": tool_name,
            "platform": platform.platform(),
            "processor": platform.processor(),
            "cpuCount": os.cpu_count(),
            "memory": memory,
            "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
            "gpu": gpu_info,
            "timestamp": _now_iso(),
        }

    if tool_name == "get_running_processes":
        output = subprocess.run(["tasklist"], capture_output=True, text=True, timeout=MAX_SHELL_TIMEOUT, check=False)
        return {"tool": tool_name, "output": (output.stdout or output.stderr or "").strip(), "timestamp": _now_iso()}

    if tool_name == "read_clipboard":
        output = _run_powershell("Get-Clipboard")
        return {"tool": tool_name, "content": output, "timestamp": _now_iso()}

    if tool_name == "write_file":
        file_path = normalize_path(params.get("path"))
        file_path.parent.mkdir(parents=True, exist_ok=True)
        content = str(params.get("content", ""))
        file_path.write_text(content, encoding="utf-8")
        return {
            "tool": tool_name,
            "path": str(file_path),
            "bytesWritten": len(content.encode("utf-8")),
            "timestamp": _now_iso(),
        }

    if tool_name == "create_directory":
        directory = normalize_path(params.get("path"))
        directory.mkdir(parents=True, exist_ok=True)
        return {"tool": tool_name, "path": str(directory), "timestamp": _now_iso()}

    if tool_name == "search_files":
        base_path = normalize_path(params.get("path") or str(Path.home()))
        query = str(params.get("query", "")).strip().lower()
        results: List[str] = []
        if not query:
            raise ValueError("Search query is required.")
        for root, _dirs, files in os.walk(base_path):
            for name in files:
                if query in name.lower():
                    results.append(str(Path(root) / name))
                    if len(results) >= 100:
                        break
            if len(results) >= 100:
                break
        return {
            "tool": tool_name,
            "query": query,
            "basePath": str(base_path),
            "results": results,
            "timestamp": _now_iso(),
        }

    if tool_name == "write_clipboard":
        text = str(params.get("text", ""))
        _run_powershell(f"Set-Clipboard -Value @'\n{text}\n'@")
        return {"tool": tool_name, "result": "Clipboard updated.", "timestamp": _now_iso()}

    if tool_name == "run_shell_command":
        command = str(params.get("command", ""))
        completed = subprocess.run(
            ["cmd.exe", "/c", command],
            capture_output=True,
            text=True,
            timeout=MAX_SHELL_TIMEOUT,
            check=False,
        )
        return {
            "tool": tool_name,
            "command": command,
            "exitCode": completed.returncode,
            "stdout": (completed.stdout or "").strip(),
            "stderr": (completed.stderr or "").strip(),
            "timestamp": _now_iso(),
        }

    if tool_name == "delete_file":
        target = normalize_path(params.get("path"))
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        else:
            raise FileNotFoundError(f"Target not found: {target}")
        return {"tool": tool_name, "path": str(target), "timestamp": _now_iso()}

    if tool_name == "kill_process":
        pid = int(params.get("pid"))
        completed = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T"],
            capture_output=True,
            text=True,
            timeout=MAX_SHELL_TIMEOUT,
            check=False,
        )
        return {
            "tool": tool_name,
            "pid": pid,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
            "timestamp": _now_iso(),
        }

    if tool_name == "open_url":
        url = str(params.get("url", "")).strip()
        webbrowser.open(url)
        return {"tool": tool_name, "url": url, "timestamp": _now_iso()}

    raise PermissionError(f"Unsupported tool: {tool_name}")
