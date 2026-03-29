# Bloom Multi-Task System Implementation Plan

## Objective

Add a multi-task agent workflow to Bloom so one user request can be split into tracked parallel tasks with live updates, safe tool execution, and a clear task management UI.

This should move Bloom from a single-threaded chat assistant toward a structured developer workbench without breaking existing chat, MCP, permissions, or installer flows.

---

## Current Bloom Baseline

Bloom already includes a strong starting point:

- Electron desktop shell with `main.js`, `preload.js`, and renderer-driven UI
- FastAPI backend in `backend/`
- Existing agent loop with tool proposals, approvals, audit logging, and structured SSE events
- MCP integration with server configuration, status endpoints, and agent routing
- Local Ollama runtime handling and cloud-model support
- Session history, settings persistence, and installer packaging

This means the multi-task system should be integrated into the current architecture rather than replacing it.

---

## Architecture Goal

Target behavior:

- A user can submit one large request and Bloom can split it into multiple tracked tasks
- Each task can run as an isolated sub-agent with its own progress, outputs, and final result
- Safe read-only operations can run concurrently
- Risky or write operations must still respect Bloom's permission and audit flow
- The frontend shows live task status, logs, and results in a dedicated task panel
- Existing normal chat should continue to work

Guiding principle:

- Supplement Bloom's current agent loop instead of rewriting everything at once

---

## Recommended Sub-Agent Topology

Bloom should not start with an open-ended number of agents. The first release should use a small, opinionated topology that is easy to understand, debug, and visualize in the UI.

### Recommended Roles

1. `Planner Agent`
- Breaks the user goal into smaller tasks
- Decides which work can run in parallel
- Prevents duplicate or conflicting work

2. `File Agent`
- Reads files
- Writes files
- Creates folders
- Handles project structure changes

3. `Shell Agent`
- Runs safe shell commands
- Handles lint, build, dependency, and environment checks
- Summarizes command output for the task system

4. `Search/Test Agent`
- Searches code, symbols, TODOs, and references
- Runs tests and summarizes failures
- Verifies that fixes actually worked

### Recommended Counts

- Total agent roles in MVP: `4`
- Concurrent worker agents at once: `3`
- One planner + up to three active workers

### Why This Layout

- It covers Bloom's main developer workflows without creating a noisy or overly complex system
- It maps cleanly to the task diagram and task panel UI
- It keeps resource usage under control for both cloud and local models
- It gives each agent a clear responsibility, which reduces collisions and debugging pain

### Not Recommended for MVP

- Dedicated review-only agent
- Unlimited worker spawning
- Deep agent trees or recursive agent spawning

Those can come later after the task foundation, UI, and safety model are stable.

---

## Phase 1 - Task Foundation

### Goal

Create the backend primitives for task creation, storage, status tracking, and shared context.

### Files to Add

- `backend/task_manager.py`

### Files to Modify

- `backend/main.py`

### Backend Work

- Add `TaskStatus` enum:
  - `pending`
  - `running`
  - `paused`
  - `done`
  - `failed`
  - `cancelled`
- Add `TaskPriority` enum:
  - `low`
  - `normal`
  - `high`
  - `urgent`
- Add `Task` model with:
  - id
  - title
  - description
  - priority
  - status
  - created_at
  - started_at
  - finished_at
  - progress
  - error
  - result
  - parent_id
  - tags
- Add `SharedContext` store for cross-task memory
- Add `TaskManager` with:
  - submit task
  - list tasks
  - get task
  - cancel task
  - update progress
  - store output logs
- Add task manager startup/shutdown into FastAPI lifespan

### Risks

- Creating a new orchestration layer that drifts from current session and history systems
- Making task state too generic without enough metadata for later UI needs

### Verification

- Start backend successfully
- Create one backend task without UI
- List tasks and verify status changes
- Cancel a task and confirm cleanup

### Done Criteria

- Bloom backend can manage and inspect tasks independently of the chat flow

---

## Phase 2 - Sub-Agent Runner

### Goal

Make each task execute as its own isolated sub-agent that can use Bloom's existing agent logic.

### Files to Add

- `backend/sub_agent.py`

### Files to Modify

- `backend/agent_loop.py`
- `backend/task_manager.py`

### Backend Work

- Add a `SubAgent` class or factory that wraps:
  - goal
  - role
  - selected model
  - temperature
  - task-local message history
  - references to shared context
  - MCP manager
  - permission settings
- Start with explicit roles:
  - `planner`
  - `file`
  - `shell`
  - `search_test`
- Ensure the planner can create worker tasks, but do not allow recursive unlimited spawning
- Enforce worker concurrency cap:
  - default maximum running workers = `3`
- Reuse Bloom's current:
  - tool extraction
  - proposal flow
  - safety blocks
  - audit logging
- Ensure each sub-agent reports:
  - progress updates
  - intermediate outputs
  - final summary
  - failure details

### Risks

- Duplicating logic from `agent_loop.py`
- Sub-agents diverging from Bloom's current approval and audit standards
- Making role boundaries too vague, which creates duplicate work

### Verification

- Spawn one task that reads files or inspects a folder
- Spawn a planner-led task that fans out into two or three worker subtasks
- Confirm task output appears and task finishes cleanly
- Confirm safety and proposal behavior still applies

### Done Criteria

- One backend task can run a self-contained Bloom sub-agent end to end
- Planner and worker roles are distinguishable in backend state

---

## Phase 3 - Parallel Tool Execution

### Goal

Speed up heavy tasks by allowing safe read-only tools to run concurrently.

### Files to Add

- `backend/parallel_executor.py`

### Files to Modify

- `backend/sub_agent.py`
- `backend/agent_tools.py`

### Backend Work

- Add `ParallelToolExecutor`
- Allow safe concurrent execution for read-only tools such as:
  - `list_directory`
  - `read_file`
  - `search_files`
  - `get_system_info`
  - `get_running_processes`
  - `read_clipboard`
- Serialize write and destructive tools through a lock
- Optionally support MCP tools later, but do not depend on that in the first version

### Risks

- Race conditions on filesystem writes
- Duplicate work if multiple tool calls inspect the same targets
- Local model overhead may reduce real-world benefit if task planning is weak

### Verification

- Fan out multiple read tasks against a repo
- Confirm outputs are aggregated correctly
- Confirm write tools remain serialized

### Done Criteria

- Sub-agents can perform safe concurrent backend tool calls without corrupting state

---

## Phase 4 - Task API + Real-Time Events

### Goal

Expose task management through backend routes and stream task updates to the frontend.

### Files to Add

- `backend/task_api.py`

### Files to Modify

- `backend/main.py`

### Backend Work

- Add task router with endpoints:
  - `POST /tasks/spawn`
  - `GET /tasks`
  - `GET /tasks/{id}`
  - `POST /tasks/{id}/cancel`
  - `POST /tasks/{id}/pause`
  - `POST /tasks/{id}/resume`
- Add WebSocket endpoint:
  - `GET /tasks/ws`
- Add task event bus for:
  - `task_status`
  - `task_output`
  - `task_progress`
  - `task_error`
  - `task_done`

### Risks

- WebSocket lifecycle issues during app restart or backend reconnect
- Task output flooding renderer with too many events

### Verification

- Spawn task through API
- Open WebSocket and observe live task updates
- Cancel task through API and confirm streamed status changes

### Done Criteria

- Backend supports live task orchestration and event streaming to frontend

---

## Phase 5 - Task Panel UI

### Goal

Add a task management interface so users can see and interact with background work.

### Files to Add

- `frontend/task_panel.js` or integrate directly into `frontend/renderer.js`

### Files to Modify

- `frontend/index.html`
- `frontend/renderer.js`

### Frontend Work

- Add a task toggle button in the header or sidebar
- Add task panel with:
  - active tasks
  - queued tasks
  - completed tasks
  - failed tasks
- Add task detail pane with:
  - live output log
  - progress
  - status badge
  - cancel action
  - pause/resume action
- Add quick spawn form
- Make it fit Bloom's current UI rather than feeling bolted on

### Risks

- UI clutter
- Task panel competing visually with the main chat area
- Too much streaming text making the app feel noisy

### Verification

- Spawn task from UI
- Watch live status change in panel
- Open finished task and inspect logs

### Done Criteria

- Multi-tasking becomes visible and usable in the Bloom frontend

---

## Phase 6 - Chat Integration

### Goal

Allow users to trigger tasks naturally from chat instead of only from a task API or panel.

### Files to Modify

- `frontend/renderer.js`
- `backend/main.py`
- `backend/task_api.py`

### Work

- Add a task syntax such as:
  - `spawn: task one | task two | task three`
- Add a UI affordance to promote a message into one or more tasks
- Support chat-driven multi-step workflows where Bloom suggests task splitting
- Keep standard single-threaded chat behavior available

### Risks

- Ambiguity between normal chat and task mode
- Unexpected task spawning from casual prompts

### Verification

- Use a `spawn:` prompt and verify multiple tasks are created
- Verify normal prompts still go through existing chat flow

### Done Criteria

- Task spawning feels native to Bloom chat

---

## Phase 7 - File Watcher

### Goal

Let Bloom monitor folders and trigger tasks reactively when files change.

### Files to Add

- `backend/file_watcher.py`

### Files to Modify

- `backend/main.py`
- `backend/task_api.py`

### Work

- Add folder watch registration
- Support pattern filtering such as:
  - `*.py`
  - `*.js`
  - `*.ts`
- Support optional auto-task creation on matching changes
- Emit file-change events through WebSocket

### Risks

- Noisy or excessive triggers
- Resource usage from polling or watcher churn
- Recursive loops if Bloom edits files that the watcher immediately reacts to

### Verification

- Watch a project folder
- Change a matching file
- Confirm watcher event appears
- Confirm optional auto-task triggers only when expected

### Done Criteria

- Bloom can react to project changes without manual task spawning

---

## Phase 8 - Safety Hardening

### Goal

Prevent concurrency bugs, runaway task growth, and unsafe multi-agent behavior.

### Files to Modify

- `backend/task_manager.py`
- `backend/sub_agent.py`
- `backend/parallel_executor.py`
- `backend/agent_loop.py`
- `frontend/renderer.js`

### Work

- Add max concurrent task cap
- Add per-task timeout
- Add per-agent loop limit
- Add duplicate task suppression or detection
- Add file write ownership rules
- Add cancellation cleanup
- Add better failure surfaces in UI
- Keep existing Bloom proposal and approval model intact

### Risks

- Tasks stepping on the same files
- Zombie tasks after app close or backend restart
- Users losing trust if parallel work feels uncontrolled

### Verification

- Spawn many tasks and confirm limits hold
- Cancel running tasks
- Confirm write conflicts are prevented or surfaced clearly

### Done Criteria

- Multi-task system behaves predictably under load and failure

---

## Phase 9 - MCP + Task Fusion

### Goal

Allow tasks and sub-agents to use MCP tools safely in the same system.

### Files to Modify

- `backend/mcp_manager.py`
- `backend/sub_agent.py`
- `backend/parallel_executor.py`
- `backend/agent_loop.py`

### Work

- Allow sub-agents to call MCP tools
- Keep MCP calls under Bloom approval and audit flow
- Show MCP-origin actions clearly in task logs
- Support tool metadata in task UI

### Risks

- External MCP tools may be slower or less predictable than native tools
- Increased permission complexity
- More difficulty reproducing issues across user machines

### Verification

- Spawn task that uses one native tool and one MCP tool
- Confirm approval flow still works
- Confirm task output identifies MCP source cleanly

### Done Criteria

- Multi-task mode can safely extend beyond native Bloom tools

---

## Phase 10 - Polish, Tests, and Release Readiness

### Goal

Make the feature reliable enough to ship confidently.

### Files to Add

- `backend/tests/test_task_manager.py`
- `backend/tests/test_task_api.py`
- `backend/tests/test_parallel_executor.py`
- Optional frontend integration tests if later adopted

### Files to Modify

- `README.md`
- `BUILD.md`
- installer-related docs if behavior changes

### Work

- Add backend tests
- Add task-related UI polish
- Add onboarding hints in Bloom
- Add model/task guidance in UI
- Improve empty states and error text
- Confirm installer still packages everything cleanly

### Risks

- Feature drift if tests are delayed
- Users discovering edge cases faster than the UI explains them

### Verification

- `npm test`
- `node --check main.js`
- `node --check preload.js`
- `node --check frontend/renderer.js`
- `npm run build:win`
- manual task workflow checks in packaged app

### Done Criteria

- Feature is stable enough for broader user testing

---

## Recommended MVP Cutoff

The safest first shippable version should stop after **Phase 5**.

Why:

- It gives Bloom a real multi-task backend
- It gives users visible value with a task panel
- It avoids early overreach into file watching and deeper automation
- It keeps the implementation smaller and more testable

MVP includes:

- task manager
- sub-agent execution
- real-time task events
- task panel UI
- basic task spawning
- fixed role layout:
  - one planner
  - up to three workers

Do not call the feature complete until Phase 8 is done.

---

## Suggested Rollout Order

Recommended implementation order for Bloom:

1. Phase 1 - Task Foundation
2. Phase 2 - Sub-Agent Runner
3. Phase 4 - Task API + Real-Time Events
4. Phase 5 - Task Panel UI
5. Phase 3 - Parallel Tool Execution
6. Phase 8 - Safety Hardening
7. Phase 6 - Chat Integration
8. Phase 7 - File Watcher
9. Phase 9 - MCP + Task Fusion
10. Phase 10 - Polish, Tests, and Release Readiness

This order gives backend structure first, visible UI next, then performance, then automation.

---

## Main Risks Across the Project

- Multi-agent write conflicts on the same files
- Too much UI noise from concurrent streams
- Local models becoming slow or unstable when many tasks run
- Harder debugging and user support
- Permission fatigue if too many approvals appear at once
- Increased backend lifecycle complexity on startup/shutdown
- Agents overlapping in responsibility and performing the same work twice

Mitigation strategy:

- keep concurrency caps conservative
- keep write actions serialized
- keep task logs explicit
- reuse existing Bloom safety systems
- ship the MVP before adding reactive automation

---

## Verification Matrix

### Core Task Flow

- Spawn one task
- Spawn multiple tasks
- Complete a task successfully
- Fail a task and surface the error
- Cancel a running task

### Agent Behavior

- Sub-agent respects existing tool approval flow
- Sub-agent respects safety blocks
- Sub-agent writes audit entries properly

### Parallelism

- Multiple read-only tasks can run concurrently
- Write tasks do not conflict
- Task queue respects priority

### Frontend

- Task panel opens and closes cleanly
- Task list updates in real time
- Task output pane shows incremental logs
- WebSocket reconnect behaves cleanly after backend interruption

### MCP

- MCP tool calls inside a task work
- MCP failures are visible in task logs
- MCP approvals remain consistent with standard Bloom behavior

### Packaging

- `npm test`
- `npm run build:win`
- Installer launches successfully
- Packaged app can create and stream tasks

---

## Definition of Success

This project is successful when:

- Bloom can run multiple visible tasks in parallel
- Users can understand what each task is doing
- Bloom remains safe and predictable
- Existing chat features continue to work
- The app still feels polished rather than experimental

The goal is not to make Bloom "do everything at once."
The goal is to make Bloom handle larger developer workflows with more structure, visibility, and speed.
