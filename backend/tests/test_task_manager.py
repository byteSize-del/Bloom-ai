import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from task_manager import TaskManager, TaskStatus, TaskPriority, TaskStep


def test_submit_and_get_task():
    tm = TaskManager()
    task = asyncio.run(tm.submit(title="Test task", description="A test", role=TaskStep.FILE))
    assert task.id
    assert task.title == "Test task"
    assert task.status == TaskStatus.PENDING
    assert task.role == TaskStep.FILE

    fetched = asyncio.run(tm.get_task(task.id))
    assert fetched is not None
    assert fetched.id == task.id

    asyncio.run(tm.cancel_task(task.id))


def test_list_tasks():
    tm = TaskManager()
    t1 = asyncio.run(tm.submit(title="List test 1", role=TaskStep.SEARCH))
    t2 = asyncio.run(tm.submit(title="List test 2", role=TaskStep.SHELL))
    tasks = asyncio.run(tm.list_tasks())
    assert len(tasks) >= 2

    asyncio.run(tm.cancel_task(t1.id))
    asyncio.run(tm.cancel_task(t2.id))


def test_cancel_task():
    tm = TaskManager()
    task = asyncio.run(tm.submit(title="Cancel me"))
    assert asyncio.run(tm.cancel_task(task.id)) is True
    assert asyncio.run(tm.get_task(task.id)).status == TaskStatus.CANCELLED


def test_duplicate_task_suppression():
    tm = TaskManager()
    asyncio.run(tm.submit(title="Dup title", role=TaskStep.FILE))
    try:
        asyncio.run(tm.submit(title="Dup title", role=TaskStep.FILE))
        assert False, "Should have raised"
    except RuntimeError as e:
        assert "Duplicate" in str(e)


def test_pause_resume_task():
    tm = TaskManager()
    task = asyncio.run(tm.submit(title="Pause me", role=TaskStep.TEST))
    assert asyncio.run(tm.pause_task(task.id)) is False

    asyncio.run(tm.cancel_task(task.id))


def test_shared_context():
    tm = TaskManager()
    sc = tm.get_shared_context()
    asyncio.run(sc.set("key1", "value1"))
    val = asyncio.run(sc.get("key1"))
    assert val == "value1"


if __name__ == "__main__":
    test_submit_and_get_task()
    test_list_tasks()
    test_cancel_task()
    test_duplicate_task_suppression()
    test_pause_resume_task()
    test_shared_context()
    print("All task_manager tests passed!")
