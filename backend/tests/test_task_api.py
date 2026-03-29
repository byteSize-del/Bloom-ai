import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from task_api import router, _role_from_str, _priority_from_str, SubAgentRole, TaskPriority
from task_manager import TaskManager, TaskStatus


def test_role_mapping():
    assert _role_from_str("planner") == SubAgentRole.PLANNER
    assert _role_from_str("FILE") == SubAgentRole.FILE
    assert _role_from_str("search") == SubAgentRole.SEARCH
    assert _role_from_str("shell") == SubAgentRole.SHELL
    assert _role_from_str("test") == SubAgentRole.TEST
    assert _role_from_str("review") == SubAgentRole.REVIEW


def test_priority_mapping():
    assert _priority_from_str("low") == TaskPriority.LOW
    assert _priority_from_str("high") == TaskPriority.HIGH
    assert _priority_from_str("urgent") == TaskPriority.URGENT
    assert _priority_from_str("normal") == TaskPriority.NORMAL
    assert _priority_from_str("unknown") == TaskPriority.NORMAL


if __name__ == "__main__":
    test_role_mapping()
    test_priority_mapping()
    print("All task_api tests passed!")
