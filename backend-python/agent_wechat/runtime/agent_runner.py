"""在被唤醒后，从存储里取出该 Agent 未读消息，构造对话历史，调用 LangGraph(/LLM) 生成回复，并把过程通过事件总线推送给后端(/UI) 做实时展示，必要时自动把回复发回群聊."""

import asyncio
import json
import logging
from typing import Callable, Optional

from ..storage.store import store
from .event_bus import get_agent_event_bus
from .ui_bus import get_workspace_ui_bus
from .agent_graph import get_agent_graph, build_system_prompt
from .agent_state import AgentState, HistoryMessage

logger = logging.getLogger(__name__)


class AgentRunner:
    """Manages a single agent's message processing loop."""

    def __init__(
        self,
        agent_id: str,
        ensure_runner: Callable[[str], None],
        wake_agent: Callable[[str], None],
    ):
        self.agent_id = agent_id
        self.ensure_runner = ensure_runner
        self.wake_agent = wake_agent
        self._wake_event = asyncio.Event()
        self._started = False
        self._running = False
        self._task: Optional[asyncio.Task] = None
    #只允许启动一次（self._started）。
    # 用 asyncio.create_task() 把 _loop() 挂到事件循环中常驻运行。
    def start(self):
        """Start the agent's processing loop."""
        if self._started:
            return
        self._started = True
        self._task = asyncio.create_task(self._loop())

    def wakeup(self, reason: str = "manual"):
        """唤醒 Agent 处理消息"""
        logger.info(f"Waking up agent {self.agent_id}, reason: {reason}")
        self._wake_event.set()

        bus = get_agent_event_bus()
        bus.emit(self.agent_id, {
            "event": "agent.wakeup",
            "data": {"agentId": self.agent_id, "reason": reason},
        })

    async def _loop(self):
        """主循环"""
        while True:
            await self._wake_event.wait()
            self._wake_event.clear()

            if self._running:
                continue

            self._running = True
            try:
                # 一直处理到没有未读消息
                await self._process_until_idle()
            except Exception as e:
                logger.exception(f"Agent {self.agent_id} error: {e}")
                bus = get_agent_event_bus()
                bus.emit(self.agent_id, {
                    "event": "agent.error",
                    "data": {"message": str(e)},
                })
            finally:
                self._running = False

    async def _process_until_idle(self):
        """Process all unread messages until none remain."""
        # Check if agent is human
        try:
            agent = store.get_agent(self.agent_id)
            if agent["role"] == "human":
                return
        except Exception:
            return

        while True:
            # Get unread messages
            batches = store.list_unread_by_group(self.agent_id)
            if not batches:
                return

            # Emit unread event
            bus = get_agent_event_bus()
            bus.emit(self.agent_id, {
                "event": "agent.unread",
                "data": {
                    "agentId": self.agent_id,
                    "batches": [
                        {
                            "groupId": batch["groupId"],
                            "messageIds": [m["id"] for m in batch["messages"]],
                        }
                        for batch in batches
                    ],
                },
            })

            # Process each batch
            for batch in batches:
                await self._process_group_unread(
                    batch["groupId"],
                    batch["messages"],
                )

    async def _process_group_unread(
        self,
        group_id: str,
        unread_messages: list[dict],
    ):
        """Process unread messages for a group."""
        # Get workspace and agent info
        workspace_id = store.get_group_workspace_id(group_id)
        agent = store.get_agent(self.agent_id)

        # Load or initialize history
        history_raw = agent.get("llmHistory", "[]")
        try:
            history = json.loads(history_raw) if history_raw else []
        except json.JSONDecodeError:
            history = []

        if not isinstance(history, list):
            history = []

        # Initialize system message if empty
        if not history:
            system_prompt = build_system_prompt(
                self.agent_id,
                workspace_id,
                agent["role"],
            )
            history.append({
                "role": "system",
                "content": system_prompt,
            })

        # Add user messages
        user_content = "\n".join(
            f"[group:{group_id}] {m['senderId']}: {m['content']}"
            for m in unread_messages
        )
        history.append({"role": "user", "content": user_content})

        # Mark messages as read
        last_id = unread_messages[-1]["id"] if unread_messages else None
        if last_id:
            store.mark_group_read_to_message(group_id, self.agent_id, last_id)

        # Run agent graph
        result = await self._run_agent_graph(
            workspace_id=workspace_id,
            group_id=group_id,
            history=history,
        )

        # Save assistant response if non-empty
        assistant_text = result.get("content", "")
        assistant_thinking = result.get("reasoning", "")

        # 获取 UI 事件总线
        ui_bus = get_workspace_ui_bus()

        if assistant_text and assistant_text.strip():
            history.append({
                "role": "assistant",
                "content": assistant_text,
                "reasoning_content": assistant_thinking or None,
            })

            # 自动发送助手回复到群聊（如果没有工具调用），并通过 UI 事件总线推送消息创建事件
            tool_calls = result.get("tool_calls", [])
            if not tool_calls: # 如果没有调用工具
                try:
                    msg_result = store.send_message(
                        group_id=group_id,
                        sender_id=self.agent_id,
                        content=assistant_text.strip(),
                        content_type="text",
                    )
                    logger.info(f"Auto-sent agent response to group {group_id}")
                    
                    # Emit UI event for the new message
                    member_ids = store.list_group_member_ids(group_id)
                    ui_bus.emit(workspace_id, {
                        "event": "ui.message.created",
                        "data": {
                            "workspaceId": workspace_id,
                            "groupId": group_id,
                            "memberIds": member_ids,
                            "message": {
                                "id": msg_result["id"],
                                "senderId": self.agent_id,
                                "sendTime": msg_result["sendTime"],
                            },
                        },
                    })
                except Exception as e:
                    logger.warning(f"Failed to auto-send agent response: {e}")

        # Persist history
        store.set_agent_history(
            self.agent_id,
            json.dumps(history),
            workspace_id,
        )

        # Update group context tokens (estimate: ~4 chars per token)
        try:
            history_json = json.dumps(history, ensure_ascii=False)
            estimated_tokens = len(history_json) // 4
            store.set_group_context_tokens(group_id, estimated_tokens)
            logger.info(f"Updated group {group_id} context tokens: {estimated_tokens}")
        except Exception as e:
            logger.warning(f"Failed to update context tokens for group {group_id}: {e}")

        # Emit UI event
        ui_bus.emit(workspace_id, {
            "event": "ui.agent.history.persisted",
            "data": {
                "workspaceId": workspace_id,
                "agentId": self.agent_id,
                "groupId": group_id,
                "historyLength": len(history),
            },
        })

    async def _run_agent_graph(
        self,
        workspace_id: str,
        group_id: str,
        history: list[dict],
    ) -> dict:
        """Run the LangGraph agent."""
        bus = get_agent_event_bus()
        ui_bus = get_workspace_ui_bus()

        # Emit LLM start
        ui_bus.emit(workspace_id, {
            "event": "ui.agent.llm.start",
            "data": {
                "workspaceId": workspace_id,
                "agentId": self.agent_id,
                "groupId": group_id,
                "round": 0,
            },
        })

        try:
            # Build initial state
            initial_state: AgentState = {
                "agent_id": self.agent_id,
                "workspace_id": workspace_id,
                "group_id": group_id,
                "history": history,
                "pending_tool_calls": [],
                "tool_results": [],
                "round": 0,
                "content": "",
                "reasoning": "",
                "error": None,
                "finish_reason": None,
            }

            # Get compiled graph
            graph = get_agent_graph()

            # Stream events for real-time updates
            final_state = initial_state
            async for event in graph.astream_events(initial_state, version="v2"):
                event_type = event.get("event", "")
                event_name = event.get("name", "")
                event_data = event.get("data", {})

                # Handle streaming content
                if event_type == "on_chat_model_stream":
                    chunk = event_data.get("chunk")
                    if chunk:
                        # Reasoning/Thinking stream (Qwen, Claude, etc.)
                        reasoning_delta = None
                        if hasattr(chunk, "reasoning_content") and chunk.reasoning_content:
                            reasoning_delta = chunk.reasoning_content
                        elif hasattr(chunk, "additional_kwargs"):
                            ak = chunk.additional_kwargs
                            if "reasoning_content" in ak:
                                reasoning_delta = ak["reasoning_content"]
                            elif "thinking" in ak:
                                reasoning_delta = ak["thinking"]
                        
                        if reasoning_delta:
                            bus.emit(self.agent_id, {
                                "event": "agent.stream",
                                "data": {"kind": "reasoning", "delta": reasoning_delta},
                            })
                        
                        # Tool calls stream
                        if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                            for tc_chunk in chunk.tool_call_chunks:
                                tc_id = tc_chunk.get("id") or ""
                                tc_name = tc_chunk.get("name") or ""
                                tc_args = tc_chunk.get("args") or ""
                                if tc_args:
                                    bus.emit(self.agent_id, {
                                        "event": "agent.stream",
                                        "data": {
                                            "kind": "tool_calls",
                                            "delta": tc_args,
                                            "tool_call_id": tc_id,
                                            "tool_call_name": tc_name,
                                        },
                                    })

                        # Content stream
                        if hasattr(chunk, "content") and chunk.content:
                            bus.emit(self.agent_id, {
                                "event": "agent.stream",
                                "data": {"kind": "content", "delta": chunk.content},
                            })
                # Handle tool calls
                if event_type == "on_tool_start":
                    tool_name = event_name
                    ui_bus.emit(workspace_id, {
                        "event": "ui.agent.tool_call.start",
                        "data": {
                            "workspaceId": workspace_id,
                            "agentId": self.agent_id,
                            "groupId": group_id,
                            "toolName": tool_name,
                        },
                    })

                if event_type == "on_tool_end":
                    tool_name = event_name
                    tool_output = event_data.get("output", "")
                    # Send tool result to agent stream
                    bus.emit(self.agent_id, {
                        "event": "agent.stream",
                        "data": {
                            "kind": "tool_result",
                            "delta": str(tool_output)[:500],  # 限制长度
                            "tool_call_name": tool_name,
                        },
                    })
                    ui_bus.emit(workspace_id, {
                        "event": "ui.agent.tool_call.done",
                        "data": {
                            "workspaceId": workspace_id,
                            "agentId": self.agent_id,
                            "groupId": group_id,
                            "toolName": tool_name,
                            "ok": True,
                        },
                    })

                # Capture final state
                if event_type == "on_chain_end" and event_name == "LangGraph":
                    output = event_data.get("output", {})
                    if isinstance(output, dict):
                        final_state = output

            # Emit done event
            finish_reason = final_state.get("finish_reason", "stop")
            bus.emit(self.agent_id, {
                "event": "agent.done",
                "data": {"finishReason": finish_reason},
            })

            ui_bus.emit(workspace_id, {
                "event": "ui.agent.llm.done",
                "data": {
                    "workspaceId": workspace_id,
                    "agentId": self.agent_id,
                    "groupId": group_id,
                    "finishReason": finish_reason,
                },
            })

            return {
                "content": final_state.get("content", ""),
                "reasoning": final_state.get("reasoning", ""),
                "tool_calls": final_state.get("pending_tool_calls", []),
                "finish_reason": finish_reason,
            }

        except Exception as e:
            logger.exception(f"Agent graph error: {e}")
            bus.emit(self.agent_id, {
                "event": "agent.error",
                "data": {"message": str(e)},
            })
            raise
