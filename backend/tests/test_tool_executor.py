from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from tool_executor import SafeToolExecutor  # noqa: E402


def test_parse_tool_call():
    executor = SafeToolExecutor()
    payload = '<BLOOM_TOOL>{"tool":"read_file","args":{"path":"C:\\\\Temp\\\\demo.txt"},"reason":"Inspect config"}</BLOOM_TOOL>'
    parsed = executor.parse_tool_call(payload)
    assert parsed is not None
    assert parsed['tool'] == 'read_file'
    assert parsed['args']['path'] == 'C:\\Temp\\demo.txt'


def test_prepare_replace_requires_confirmation(tmp_path):
    executor = SafeToolExecutor()
    executor.blocked_paths = []
    target = tmp_path / 'app.js'
    target.write_text('const debug = false;\n', encoding='utf-8')

    pending = executor.prepare_or_execute({
        'tool': 'replace_in_file',
        'args': {
            'path': str(target),
            'find': 'false',
            'replace': 'true'
        },
        'reason': 'Enable debug'
    })

    assert pending['status'] == 'pending_confirmation'
    result = executor.confirm_request(pending['requestId'])
    assert result['success'] is True
    assert 'true' in target.read_text(encoding='utf-8')


def test_read_file_executes_without_confirmation(tmp_path):
    executor = SafeToolExecutor()
    executor.blocked_paths = []
    target = tmp_path / 'notes.txt'
    target.write_text('line 1\nline 2\nline 3\n', encoding='utf-8')

    result = executor.prepare_or_execute({
        'tool': 'read_file',
        'args': {
            'path': str(target),
            'start_line': 1,
            'end_line': 2,
        },
        'reason': 'Read notes'
    })

    assert result['success'] is True
    assert result['tool'] == 'read_file'
    assert 'line 1' in result['content']
    assert 'line 2' in result['content']


def test_extract_windows_path_stops_before_followup_text():
    executor = SafeToolExecutor()
    extracted = executor._extract_windows_path(
        'edit this html file in C:\\Users\\sayye\\OneDrive\\Desktop\\bloom app.web and redesign all website'
    )
    assert extracted == 'C:\\Users\\sayye\\OneDrive\\Desktop\\bloom app.web'
