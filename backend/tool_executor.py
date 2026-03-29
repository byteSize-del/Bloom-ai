from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


class SafeToolExecutor:
    def __init__(self):
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        home = Path.home()
        self.blocked_paths = [
            Path(os.environ.get('WINDIR', r'C:\Windows')),
            Path(os.environ.get('ProgramFiles', r'C:\Program Files')),
            Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')),
            Path(os.environ.get('ProgramData', r'C:\ProgramData')),
            home / 'AppData',
        ]
        self.allowed_apps = {
            'notepad': ('notepad.exe', 'Notepad'),
            'calculator': ('calc.exe', 'Calculator'),
            'explorer': ('explorer.exe', 'File Explorer'),
            'cmd': ('cmd.exe', 'Command Prompt'),
            'powershell': ('powershell.exe', 'PowerShell'),
            'vscode': ('code', 'VS Code'),
        }
        self.app_patterns = [
            ('notepad', re.compile(r'\b(open|launch|start)\s+(notepad|note[\s-]?pad)\b', re.IGNORECASE)),
            ('calculator', re.compile(r'\b(open|launch|start)\s+(calculator|calc)\b', re.IGNORECASE)),
            ('explorer', re.compile(r'\b(open|launch|start)\s+(file\s+explorer|explorer)\b', re.IGNORECASE)),
            ('cmd', re.compile(r'\b(open|launch|start)\s+(cmd|command\s+prompt|terminal)\b', re.IGNORECASE)),
            ('powershell', re.compile(r'\b(open|launch|start)\s+(powershell|power\s+shell)\b', re.IGNORECASE)),
            ('vscode', re.compile(r'\b(open|launch|start)\s+(vscode|vs\s*code|visual\s+studio\s+code)\b', re.IGNORECASE)),
        ]

    def get_tool_system_prompt(self) -> str:
        return (
            'You can use Bloom machine tools when the user clearly asks you to inspect local folders, read files, edit files, or launch an allowed desktop app. '
            'Available tools are list_directory, read_file, write_file, replace_in_file, and launch_app. '
            'Use a tool only when it is necessary to complete a real desktop task. '
            'When you need a tool, respond with ONLY a single tool block in this exact format and no extra text: '
            '<BLOOM_TOOL>{"tool":"read_file","args":{"path":"C:\\\\Users\\\\name\\\\file.txt"},"reason":"Short reason"}</BLOOM_TOOL>. '
            'For file edits, prefer replace_in_file when you know the exact text to replace. '
            'Never ask for tools outside this list. '
            'After you receive a TOOL RESULT system message, answer the user normally.'
        )

    def should_attempt_tooling(self, message: str) -> bool:
        text = str(message or '').lower()
        patterns = [
            r'\b(open|edit|change|replace|update|read|show|list|go to|navigate|launch|start)\b',
            r'[a-zA-Z]:\\',
            r'\.json\b|\.txt\b|\.md\b|\.py\b|\.js\b|\.ts\b|\.html\b|\.css\b|\.env\b',
            r'\bfile\b|\bfolder\b|\bdirectory\b|\bdrive\b|\bnotepad\b|\bvscode\b|\bexplorer\b',
        ]
        return any(re.search(pattern, text) for pattern in patterns)

    def infer_action_from_message(self, message: str) -> Optional[Dict[str, Any]]:
        text = str(message or '').strip()
        if not text:
            return None

        for app_name, pattern in self.app_patterns:
            if pattern.search(text):
                return {
                    'kind': 'tool_call',
                    'tool_call': {
                        'tool': 'launch_app',
                        'args': {'app': app_name},
                        'reason': f'Open {self.allowed_apps[app_name][1]} for the user',
                    },
                }

        extracted_path = self._extract_windows_path(text)
        if not extracted_path:
            return None

        candidate = self._normalize_path(extracted_path)
        resolved = candidate.resolve(strict=False)
        if self._is_blocked(resolved):
            return {
                'kind': 'message',
                'content': f"I found the path `{resolved}`, but Bloom blocks access to that system-sensitive location for safety.",
            }

        if resolved.exists() and resolved.is_dir():
            return {
                'kind': 'tool_call',
                'tool_call': {
                    'tool': 'list_directory',
                    'args': {'path': str(resolved)},
                    'reason': 'Inspect the folder the user referenced',
                },
            }

        if resolved.exists() and resolved.is_file():
            return {
                'kind': 'tool_call',
                'tool_call': {
                    'tool': 'read_file',
                    'args': {'path': str(resolved), 'start_line': 1, 'end_line': 220},
                    'reason': 'Read the file the user referenced',
                },
            }

        return {
            'kind': 'message',
            'content': (
                f"I could not find `{resolved}` on this machine. "
                'If you want me to work on a website or file, send the exact existing file path or folder path.'
            ),
        }

    def parse_tool_call(self, response_text: str) -> Optional[Dict[str, Any]]:
        match = re.search(r'<BLOOM_TOOL>\s*(\{.*?\})\s*</BLOOM_TOOL>', str(response_text or ''), re.DOTALL)
        if not match:
            return None
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None
        tool_name = str(payload.get('tool', '')).strip()
        args = payload.get('args', {})
        reason = str(payload.get('reason', '')).strip()
        if not tool_name or not isinstance(args, dict):
            return None
        return {'tool': tool_name, 'args': args, 'reason': reason}

    def prepare_or_execute(self, tool_call: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self._normalize_tool_call(tool_call)
        if normalized['tool'] in {'write_file', 'replace_in_file', 'launch_app'}:
            request_id = uuid.uuid4().hex
            payload = {
                'requestId': request_id,
                'status': 'pending_confirmation',
                'tool': normalized['tool'],
                'summary': self._summarize_request(normalized),
                'preview': self._preview_request(normalized),
                'risk': 'high' if normalized['tool'] in {'write_file', 'replace_in_file'} else 'medium',
            }
            self.pending_requests[request_id] = normalized
            return payload
        return self._execute(normalized)

    def confirm_request(self, request_id: str) -> Dict[str, Any]:
        normalized = self.pending_requests.pop(request_id)
        result = self._execute(normalized)
        return {
            'success': bool(result.get('success', True)),
            'tool': result.get('tool'),
            'message': self.format_tool_result_for_user(result),
            'result': result,
        }

    def cancel_request(self, request_id: str) -> None:
        self.pending_requests.pop(request_id)

    def build_tool_result_message(self, tool_result: Dict[str, Any]) -> str:
        safe_payload = json.dumps(tool_result, ensure_ascii=False, indent=2)
        return f"TOOL RESULT\n{safe_payload}\nUse this tool result to answer the user directly and clearly."

    def format_tool_result_for_user(self, result: Dict[str, Any]) -> str:
        return self._format_user_message(result)

    def _normalize_tool_call(self, tool_call: Dict[str, Any]) -> Dict[str, Any]:
        tool = str(tool_call.get('tool', '')).strip()
        args = dict(tool_call.get('args') or {})
        reason = str(tool_call.get('reason', '')).strip()

        if tool == 'list_directory':
            return {'tool': tool, 'path': self._normalize_path(args.get('path')), 'reason': reason}
        if tool == 'read_file':
            return {
                'tool': tool,
                'path': self._normalize_path(args.get('path')),
                'start_line': max(1, int(args.get('start_line', 1) or 1)),
                'end_line': max(1, int(args.get('end_line', 200) or 200)),
                'reason': reason,
            }
        if tool == 'write_file':
            return {
                'tool': tool,
                'path': self._normalize_path(args.get('path')),
                'content': str(args.get('content', '')),
                'reason': reason,
            }
        if tool == 'replace_in_file':
            return {
                'tool': tool,
                'path': self._normalize_path(args.get('path')),
                'find': str(args.get('find', '')),
                'replace': str(args.get('replace', '')),
                'reason': reason,
            }
        if tool == 'launch_app':
            app_name = str(args.get('app', '')).strip().lower()
            if app_name not in self.allowed_apps:
                raise PermissionError(f'Unsupported app: {app_name or "unknown"}')
            return {'tool': tool, 'app': app_name, 'reason': reason}
        raise PermissionError(f'Unsupported tool: {tool}')

    def _normalize_path(self, raw_path: Any) -> Path:
        path_text = str(raw_path or '').strip().strip('"').strip("'")
        path_text = path_text.rstrip('.,;')
        if not path_text:
            raise FileNotFoundError('Path is required for this action.')
        return Path(path_text).expanduser()

    def _extract_windows_path(self, text: str) -> Optional[str]:
        quoted = re.search(r"[\"\']([A-Za-z]:\\[^\n\r\"\']+)[\"\']", text)
        if quoted:
            return quoted.group(1).strip().rstrip('.,;')

        path_match = re.search(r'([A-Za-z]:\\.+?)(?=(?:\s+(?:and|then|please|but|also|with)\b)|$)', text, re.IGNORECASE)
        if path_match:
            return path_match.group(1).strip().rstrip('.,;')

        fallback = re.search(r'[A-Za-z]:\\[^\n\r]+', text)
        if fallback:
            return fallback.group(0).strip().rstrip('.,;')
        return None

    def _ensure_path_allowed(self, target: Path, write: bool = False) -> Path:
        resolved = target.resolve(strict=False)
        if self._is_blocked(resolved):
            raise PermissionError(f'Access to {resolved} is blocked for safety.')
        if write and resolved.drive and resolved == Path(resolved.drive + '\\'):
            raise PermissionError('Writing directly to a drive root is blocked for safety.')
        return resolved

    def _is_blocked(self, path_obj: Path) -> bool:
        candidate = str(path_obj).lower().rstrip('\\')
        for blocked in self.blocked_paths:
            blocked_text = str(blocked.resolve(strict=False)).lower().rstrip('\\')
            if candidate == blocked_text or candidate.startswith(blocked_text + '\\'):
                return True
        return False

    def _execute(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        tool = normalized['tool']
        if tool == 'list_directory':
            return self._list_directory(normalized)
        if tool == 'read_file':
            return self._read_file(normalized)
        if tool == 'write_file':
            return self._write_file(normalized)
        if tool == 'replace_in_file':
            return self._replace_in_file(normalized)
        if tool == 'launch_app':
            return self._launch_app(normalized)
        raise PermissionError(f'Unsupported tool: {tool}')

    def _list_directory(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        directory = self._ensure_path_allowed(normalized['path'])
        if not directory.exists() or not directory.is_dir():
            raise FileNotFoundError(f'Directory not found: {directory}')
        entries: List[Dict[str, Any]] = []
        for item in sorted(directory.iterdir(), key=lambda value: (not value.is_dir(), value.name.lower()))[:120]:
            entries.append({
                'name': item.name,
                'type': 'directory' if item.is_dir() else 'file',
                'size': item.stat().st_size if item.is_file() else None,
            })
        return {
            'tool': 'list_directory',
            'success': True,
            'path': str(directory),
            'entries': entries,
            'summary': f'Listed {len(entries)} items in {directory}.',
        }

    def _read_file(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        file_path = self._ensure_path_allowed(normalized['path'])
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f'File not found: {file_path}')
        raw = file_path.read_text(encoding='utf-8', errors='ignore').splitlines()
        start_line = min(max(1, normalized['start_line']), max(1, len(raw) or 1))
        end_line = min(max(start_line, normalized['end_line']), start_line + 399, len(raw) or start_line)
        excerpt = raw[start_line - 1:end_line]
        return {
            'tool': 'read_file',
            'success': True,
            'path': str(file_path),
            'start_line': start_line,
            'end_line': end_line,
            'content': '\n'.join(excerpt),
            'summary': f'Read lines {start_line}-{end_line} from {file_path}.',
        }

    def _write_file(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        file_path = self._ensure_path_allowed(normalized['path'], write=True)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(normalized['content'], encoding='utf-8')
        return {
            'tool': 'write_file',
            'success': True,
            'path': str(file_path),
            'bytesWritten': len(normalized['content'].encode('utf-8')),
            'summary': f'Wrote {file_path.name} successfully.',
        }

    def _replace_in_file(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        file_path = self._ensure_path_allowed(normalized['path'], write=True)
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f'File not found: {file_path}')
        if not normalized['find']:
            raise PermissionError('Replace actions need a non-empty find value.')
        content = file_path.read_text(encoding='utf-8', errors='ignore')
        occurrences = content.count(normalized['find'])
        if occurrences == 0:
            raise FileNotFoundError('Could not find the target text in the file.')
        updated = content.replace(normalized['find'], normalized['replace'])
        file_path.write_text(updated, encoding='utf-8')
        return {
            'tool': 'replace_in_file',
            'success': True,
            'path': str(file_path),
            'occurrences': occurrences,
            'summary': f'Replaced {occurrences} occurrence(s) in {file_path.name}.',
        }

    def _launch_app(self, normalized: Dict[str, Any]) -> Dict[str, Any]:
        command, label = self.allowed_apps[normalized['app']]
        subprocess.Popen(command, shell=False)
        return {
            'tool': 'launch_app',
            'success': True,
            'app': normalized['app'],
            'label': label,
            'summary': f'Opened {label} successfully.',
        }

    def _summarize_request(self, normalized: Dict[str, Any]) -> str:
        tool = normalized['tool']
        if tool == 'write_file':
            return f"Bloom wants to create or overwrite {normalized['path']}."
        if tool == 'replace_in_file':
            return f"Bloom wants to edit {normalized['path']} by replacing existing text."
        if tool == 'launch_app':
            return f"Bloom wants to open {self.allowed_apps[normalized['app']][1]}."
        return 'Bloom wants to perform a local action.'

    def _preview_request(self, normalized: Dict[str, Any]) -> str:
        tool = normalized['tool']
        if tool == 'write_file':
            content = normalized['content']
            return (content[:500] + ('\n...' if len(content) > 500 else '')) or '(empty file)'
        if tool == 'replace_in_file':
            find_text = normalized['find'][:180]
            replace_text = normalized['replace'][:180]
            return f"Find:\n{find_text}\n\nReplace with:\n{replace_text}"
        if tool == 'launch_app':
            return f"App: {self.allowed_apps[normalized['app']][1]}"
        return ''

    def _format_user_message(self, result: Dict[str, Any]) -> str:
        if not result.get('success'):
            return result.get('summary', 'The requested action failed.')
        summary = result.get('summary', 'The requested action completed successfully.')
        if result.get('tool') == 'list_directory':
            entries = result.get('entries', [])[:12]
            if entries:
                lines = [f"- **{entry['name']}** ({entry['type']})" for entry in entries]
                return f"{summary}\n\nPath: `{result['path']}`\n\n{chr(10).join(lines)}"
            return f"{summary}\n\nPath: `{result['path']}`"
        if result.get('tool') == 'read_file' and result.get('path'):
            content = str(result.get('content', '')).strip()
            excerpt = f"\n\n```text\n{content[:1600]}\n```" if content else ''
            return f"{summary}\n\nPath: `{result['path']}`{excerpt}"
        if result.get('tool') in {'write_file', 'replace_in_file'} and result.get('path'):
            return f"{summary}\n\nPath: `{result['path']}`"
        return summary
