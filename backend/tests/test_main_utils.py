from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from main import normalize_chat_role  # noqa: E402


def test_normalize_chat_role_variants():
    assert normalize_chat_role("assistant") == "assistant"
    assert normalize_chat_role("ai") == "assistant"
    assert normalize_chat_role("bot") == "assistant"
    assert normalize_chat_role("model") == "assistant"
    assert normalize_chat_role("system") == "system"
    assert normalize_chat_role("user") == "user"
    assert normalize_chat_role("anything-else") == "user"
