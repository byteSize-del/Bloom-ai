import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from parallel_executor import ParallelToolExecutor, SAFE_READ_ONLY_TOOLS


def test_safe_read_only_classification():
    pe = ParallelToolExecutor.__new__(ParallelToolExecutor)

    for tool in SAFE_READ_ONLY_TOOLS:
        assert pe.is_read_only_tool(tool) is True, f"{tool} should be read-only"

    write_tools = ["write_file", "replace_in_file", "delete_file", "run_command"]
    for tool in write_tools:
        assert pe.is_read_only_tool(tool) is False, f"{tool} should not be read-only"


def test_singleton():
    a = ParallelToolExecutor.get_instance()
    b = ParallelToolExecutor.get_instance()
    assert a is b


if __name__ == "__main__":
    test_safe_read_only_classification()
    test_singleton()
    print("All parallel_executor tests passed!")
