import asyncio
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from chat_history import ChatHistoryManager  # noqa: E402


def test_save_update_and_delete_session(tmp_path):
    data_dir = tmp_path / "sessions"
    settings_file = tmp_path / "settings.json"
    manager = ChatHistoryManager(data_dir=str(data_dir), settings_file=str(settings_file))

    session_id = asyncio.run(manager.save_session({
        "title": "Test Session",
        "model": "qwen3:4b",
        "messages": [{"role": "user", "content": "hello bloom"}]
    }))

    loaded = asyncio.run(manager.load_session(session_id))
    assert loaded is not None
    assert loaded["title"] == "Test Session"
    assert loaded["model"] == "qwen3:4b"
    assert len(loaded["messages"]) == 1

    updated = asyncio.run(manager.update_session(session_id, {
        "title": "Updated Session",
        "model": "codellama:7b",
        "messages": [
            {"role": "user", "content": "hello bloom"},
            {"role": "assistant", "content": "hi there"}
        ]
    }))
    assert updated is True

    loaded_after_update = asyncio.run(manager.load_session(session_id))
    assert loaded_after_update is not None
    assert loaded_after_update["id"] == session_id
    assert loaded_after_update["title"] == "Updated Session"
    assert loaded_after_update["model"] == "codellama:7b"
    assert len(loaded_after_update["messages"]) == 2

    deleted = asyncio.run(manager.delete_session(session_id))
    assert deleted is True
    assert asyncio.run(manager.load_session(session_id)) is None
