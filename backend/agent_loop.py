from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from agent_tools import (
    AGENT_TOOLS,
    audit_params_preview,
    effective_permission_tier,
    execute_tool,
    format_tool_command,
    is_safe,
    model_observation_from_result,
    preview_result,
    registry_json,
    risk_badge,
    summarize_tool_request,
    user_facing_tool_summary,
)

TEXT_CHUNK_SIZE = 180
PROPOSAL_TIMEOUT_SECONDS = 30
LOCAL_TASK_KEYWORDS = (
    "open",
    "launch",
    "start",
    "create",
    "write",
    "save",
    "edit",
    "modify",
    "replace",
    "delete",
    "remove",
    "move",
    "copy",
    "read file",
    "list files",
    "folder",
    "directory",
    "drive",
    "clipboard",
    "process",
    "browser",
    "notepad",
    "desktop",
    "path",
)


@dataclass
class PendingProposal:
    request_id: str
    session_id: str
    tool_name: str
    params: Dict[str, Any]
    reason: str
    risk: str
    permission_tier: int
    command_preview: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    event: asyncio.Event = field(default_factory=asyncio.Event)
    decision: Optional[str] = None
    remember_for_session: bool = False
    edited_params: Optional[Dict[str, Any]] = None

    @property
    def expires_at(self) -> datetime:
        return self.created_at + timedelta(seconds=PROPOSAL_TIMEOUT_SECONDS)


class AgentAuditLogger:
    def __init__(self) -> None:
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        self.audit_path = Path(appdata) / "OfflineAIChat" / "agent_audit.jsonl"
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        *,
        session_id: str,
        tool: str,
        params: Dict[str, Any],
        decision: str,
        risk: str,
        executed: bool,
        result_preview: str = "",
    ) -> None:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "tool": tool,
            "params": audit_params_preview(tool, params),
            "decision": decision,
            "risk": risk,
            "executed": executed,
            "result_preview": result_preview,
        }
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


class AgentLoopController:
    def __init__(self, ollama_handler) -> None:
        self.ollama_handler = ollama_handler
        self.pending_proposals: Dict[str, PendingProposal] = {}
        self.audit_logger = AgentAuditLogger()

    @property
    def audit_log_path(self) -> str:
        return str(self.audit_logger.audit_path)

    def build_system_prompt(self, base_prompt: str = "") -> str:
        agent_prompt = (
            "You are an AI agent with access to the following tools. When you need to perform a system action, "
            "respond ONLY with a JSON tool call in this exact format:\n\n"
            '{"tool": "tool_name", "params": {"key": "value"}, "reason": "plain English reason for the user"}\n\n'
            "If the user asks you to create, edit, open, save, inspect, search, run, launch, or otherwise act on the local machine, "
            "you must choose a tool first instead of explaining the task like a tutor. "
            "Do not execute anything without proposing it first. Always explain the task in the reason field. "
            "After receiving a tool result or a denial observation, continue reasoning until you can give the user a complete final answer. "
            "Default to English unless the user explicitly asks for another response language. "
            "If the user message contains quoted or pasted text in another language, treat that as reference material, not as a language switch request.\n\n"
            f"Available tools:\n{registry_json()}"
        )
        base = str(base_prompt or "").strip()
        return f"{base}\n\n{agent_prompt}".strip() if base else agent_prompt

    def looks_like_local_task_request(self, message: str) -> bool:
        text = str(message or "").strip().lower()
        if not text:
            return False
        if any(keyword in text for keyword in LOCAL_TASK_KEYWORDS):
            return True
        return ":\\" in text or text.startswith("c:\\") or text.startswith("d:\\")

    def _normalize_role(self, role: str) -> str:
        normalized = str(role or "").strip().lower()
        if normalized in {"assistant", "ai", "bot", "model"}:
            return "assistant"
        if normalized == "system":
            return "system"
        return "user"

    def build_messages(self, message: str, history: List[Dict[str, str]], system_prompt: str) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        for item in history:
            messages.append(
                {
                    "role": self._normalize_role(item.get("role", "user")),
                    "content": str(item.get("content", "")),
                }
            )
        messages.append({"role": "user", "content": str(message or "")})
        return messages

    def extract_tool_call(self, response_text: str) -> Optional[Dict[str, Any]]:
        text = str(response_text or "").strip()
        if not text:
            return None

        cleaned = text
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = cleaned.strip("`").strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()

        decoder = json.JSONDecoder()
        for start in range(len(cleaned)):
            if cleaned[start] != "{":
                continue
            try:
                payload, _ = decoder.raw_decode(cleaned[start:])
            except json.JSONDecodeError:
                continue
            tool_name = str(payload.get("tool", "")).strip()
            params = payload.get("params")
            if not tool_name or not isinstance(params, dict):
                return None
            return {
                "tool": tool_name,
                "params": params,
                "reason": str(payload.get("reason", "")).strip(),
            }
        return None

    def create_proposal(
        self,
        *,
        session_id: str,
        tool_name: str,
        params: Dict[str, Any],
        reason: str,
        strict_mode: bool,
    ) -> Dict[str, Any]:
        request_id = uuid.uuid4().hex
        tool_meta = AGENT_TOOLS.get(tool_name, {})
        permission_tier = max(1, effective_permission_tier(tool_name, params))
        risk = risk_badge(tool_meta.get("risk", "medium"))
        proposal = PendingProposal(
            request_id=request_id,
            session_id=session_id,
            tool_name=tool_name,
            params=dict(params or {}),
            reason=reason or summarize_tool_request(tool_name, params),
            risk=risk,
            permission_tier=permission_tier,
            command_preview=format_tool_command(tool_name, params),
        )
        self.pending_proposals[request_id] = proposal
        description = summarize_tool_request(tool_name, params)
        return {
            "requestId": request_id,
            "tool": tool_name,
            "toolLabel": tool_name.replace("_", " ").title(),
            "plainDescription": description,
            "reason": proposal.reason,
            "risk": risk,
            "permissionTier": permission_tier,
            "rememberForSessionAllowed": permission_tier == 2,
            "strictMode": bool(strict_mode),
            "command": proposal.command_preview,
            "params": proposal.params,
            "expiresAt": proposal.expires_at.isoformat(),
        }

    async def wait_for_decision(self, request_id: str) -> PendingProposal:
        proposal = self.pending_proposals[request_id]
        try:
            await asyncio.wait_for(proposal.event.wait(), timeout=PROPOSAL_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proposal.decision = "deny"
        finally:
            self.pending_proposals.pop(request_id, None)
        return proposal

    def resolve_proposal(
        self,
        request_id: str,
        *,
        decision: str,
        remember_for_session: bool = False,
        edited_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        proposal = self.pending_proposals.get(request_id)
        if not proposal:
            raise KeyError("Pending proposal not found")

        normalized_decision = str(decision or "").strip().lower()
        if normalized_decision not in {"allow_once", "allow_session", "deny"}:
            raise ValueError("Invalid decision")

        proposal.decision = normalized_decision
        proposal.remember_for_session = bool(remember_for_session) and proposal.permission_tier == 2
        if edited_params is not None:
            if not isinstance(edited_params, dict):
                raise ValueError("Edited params must be an object")
            proposal.edited_params = edited_params
        proposal.event.set()
        return {"success": True}

    async def _stream_text(self, text: str) -> AsyncIterator[Dict[str, Any]]:
        safe_text = str(text or "").strip()
        if not safe_text:
            yield {"type": "content", "content": "*No response content returned.*"}
            return
        for idx in range(0, len(safe_text), TEXT_CHUNK_SIZE):
            yield {"type": "content", "content": safe_text[idx: idx + TEXT_CHUNK_SIZE]}
            await asyncio.sleep(0)

    async def stream_events(
        self,
        *,
        message: str,
        model: str,
        history: List[Dict[str, str]],
        temperature: float,
        system_prompt: str,
        session_id: Optional[str],
        agent_settings: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        settings = dict(agent_settings or {})
        strict_mode = bool(settings.get("strictPermissionMode", False))
        max_depth = max(1, min(10, int(settings.get("maxAgentLoopDepth", 5) or 5)))
        network_enabled = bool(settings.get("networkToolEnabled", False))
        session_key = session_id or uuid.uuid4().hex
        messages = self.build_messages(message, history, self.build_system_prompt(system_prompt))
        last_tool_summary = ""
        forced_tool_retry_used = False

        for loop_index in range(max_depth):
            yield {
                "type": "thinking",
                "content": "Bloom is planning the safest next step." if loop_index == 0 else "Bloom is reviewing the latest tool result.",
                "step": loop_index + 1,
            }

            response_text = await self.ollama_handler.chat(
                model=model,
                messages=messages,
                temperature=temperature,
            )

            tool_call = self.extract_tool_call(response_text)
            if not tool_call:
                if not forced_tool_retry_used and self.looks_like_local_task_request(message):
                    forced_tool_retry_used = True
                    if str(response_text or "").strip():
                        messages.append({"role": "assistant", "content": response_text})
                    messages.append(
                        {
                            "role": "system",
                            "content": (
                                "The user asked for a local machine action. "
                                "Do not answer with an explanation, algorithm write-up, or copied problem statement yet. "
                                "Respond with exactly one JSON tool call from the registered tools. "
                                "Default your final user-facing language to English unless the user explicitly requested another language."
                            ),
                        }
                    )
                    continue
                final_text = response_text
                if not str(final_text or "").strip() and last_tool_summary:
                    final_text = last_tool_summary
                async for chunk in self._stream_text(final_text):
                    yield chunk
                yield {"type": "done"}
                return

            tool_name = str(tool_call.get("tool", "")).strip()
            params = dict(tool_call.get("params") or {})
            reason = str(tool_call.get("reason", "")).strip() or summarize_tool_request(tool_name, params)
            tool_meta = AGENT_TOOLS.get(tool_name)

            messages.append({"role": "assistant", "content": response_text})

            if not tool_meta:
                block_reason = "This action was blocked because the requested tool is not registered in Bloom."
                yield {"type": "safety_block", "tool": tool_name, "content": block_reason}
                messages.append({"role": "system", "content": block_reason})
                self.audit_logger.log(
                    session_id=session_key,
                    tool=tool_name or "unknown",
                    params=params,
                    decision="safety_blocked",
                    risk="Critical",
                    executed=False,
                    result_preview=block_reason,
                )
                continue

            if tool_name == "open_url" and not network_enabled:
                block_reason = "This action was blocked because opening network links is disabled in Bloom settings."
                yield {"type": "safety_block", "tool": tool_name, "content": block_reason}
                messages.append({"role": "system", "content": block_reason})
                self.audit_logger.log(
                    session_id=session_key,
                    tool=tool_name,
                    params=params,
                    decision="safety_blocked",
                    risk=risk_badge(tool_meta.get("risk", "medium")),
                    executed=False,
                    result_preview=block_reason,
                )
                continue

            safe, reason_if_blocked = is_safe(tool_name, params)
            if not safe:
                yield {"type": "safety_block", "tool": tool_name, "content": reason_if_blocked}
                messages.append({"role": "system", "content": reason_if_blocked})
                self.audit_logger.log(
                    session_id=session_key,
                    tool=tool_name,
                    params=params,
                    decision="safety_blocked",
                    risk=risk_badge(tool_meta.get("risk", "medium")),
                    executed=False,
                    result_preview=reason_if_blocked,
                )
                continue

            permission_tier = effective_permission_tier(tool_name, params)
            requires_approval = strict_mode or permission_tier > 1 or bool(tool_meta.get("requires_user_approval"))

            if requires_approval:
                proposal_payload = self.create_proposal(
                    session_id=session_key,
                    tool_name=tool_name,
                    params=params,
                    reason=reason,
                    strict_mode=strict_mode,
                )
                yield {"type": "tool_proposal", "proposal": proposal_payload}
                proposal = await self.wait_for_decision(proposal_payload["requestId"])
                final_params = proposal.edited_params if isinstance(proposal.edited_params, dict) else proposal.params

                if proposal.decision == "allow_session":
                    decision_value = "approved"
                elif proposal.decision == "allow_once":
                    decision_value = "approved"
                else:
                    denial_message = "You chose not to allow this action, so Bloom will continue without it."
                    yield {
                        "type": "tool_result",
                        "tool": tool_name,
                        "requestId": proposal.request_id,
                        "status": "denied",
                        "content": denial_message,
                    }
                    messages.append({"role": "system", "content": denial_message})
                    self.audit_logger.log(
                        session_id=session_key,
                        tool=tool_name,
                        params=final_params,
                        decision="denied",
                        risk=proposal.risk,
                        executed=False,
                        result_preview=denial_message,
                    )
                    continue

                try:
                    yield {"type": "thinking", "content": f"Bloom is executing {proposal.tool_name.replace('_', ' ')}."}
                    result = execute_tool(tool_name, final_params)
                    last_tool_summary = user_facing_tool_summary(result)
                    self.audit_logger.log(
                        session_id=session_key,
                        tool=tool_name,
                        params=final_params,
                        decision=decision_value,
                        risk=proposal.risk,
                        executed=True,
                        result_preview=preview_result(result),
                    )
                    yield {
                        "type": "tool_result",
                        "tool": tool_name,
                        "requestId": proposal.request_id,
                        "status": "approved",
                        "command": format_tool_command(tool_name, final_params),
                        "result": result,
                    }
                    messages.append({"role": "system", "content": model_observation_from_result(result)})
                except Exception as exc:
                    error_message = f"The requested action failed: {exc}"
                    yield {
                        "type": "tool_result",
                        "tool": tool_name,
                        "requestId": proposal.request_id,
                        "status": "error",
                        "content": error_message,
                    }
                    messages.append({"role": "system", "content": error_message})
                    self.audit_logger.log(
                        session_id=session_key,
                        tool=tool_name,
                        params=final_params,
                        decision="approved",
                        risk=proposal.risk,
                        executed=False,
                        result_preview=error_message,
                    )
                continue

            try:
                yield {"type": "thinking", "content": f"Bloom is auto-approving a safe {tool_name.replace('_', ' ')} action."}
                result = execute_tool(tool_name, params)
                last_tool_summary = user_facing_tool_summary(result)
                self.audit_logger.log(
                    session_id=session_key,
                    tool=tool_name,
                    params=params,
                    decision="auto_approved",
                    risk=risk_badge(tool_meta.get("risk", "medium")),
                    executed=True,
                    result_preview=preview_result(result),
                )
                yield {
                    "type": "tool_result",
                    "tool": tool_name,
                    "status": "auto_approved",
                    "command": format_tool_command(tool_name, params),
                    "result": result,
                }
                messages.append({"role": "system", "content": model_observation_from_result(result)})
            except Exception as exc:
                error_message = f"The requested action failed: {exc}"
                yield {"type": "tool_result", "tool": tool_name, "status": "error", "content": error_message}
                messages.append({"role": "system", "content": error_message})
                self.audit_logger.log(
                    session_id=session_key,
                    tool=tool_name,
                    params=params,
                    decision="auto_approved",
                    risk=risk_badge(tool_meta.get("risk", "medium")),
                    executed=False,
                    result_preview=error_message,
                )

        if last_tool_summary:
            yield {"type": "content", "content": last_tool_summary}
        else:
            yield {"type": "content", "content": "Bloom reached the current agent loop limit. You can raise it in Settings > Permissions if needed."}
        yield {"type": "done"}
