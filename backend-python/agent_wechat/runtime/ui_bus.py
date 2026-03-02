"""UI 事件总线，工作空间级别事件"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .redis_realtime import get_realtime, is_redis_configured


@dataclass
class UIEvent:
    """A UI event for a workspace."""
    id: int
    at: int  # timestamp in ms
    event: str
    data: dict


@dataclass
class ChannelState:
    """State for a workspace UI channel."""
    next_id: int = 1
    buffer: list[UIEvent] = field(default_factory=list)
    listeners: set = field(default_factory=set)


Listener = Callable[[UIEvent], None]

DEFAULT_MAX_BUFFER = 2000


class WorkspaceUIBus:
    """Event bus for workspace UI events."""

    def __init__(self, max_buffer: int = DEFAULT_MAX_BUFFER):
        self.max_buffer = max_buffer
        self._channels: dict[str, ChannelState] = {}

    def _get_channel(self, workspace_id: str) -> ChannelState:
        """Get or create a channel for a workspace."""
        if workspace_id not in self._channels:
            self._channels[workspace_id] = ChannelState()
        return self._channels[workspace_id]

    def emit(self, workspace_id: str, event: dict) -> UIEvent:
        """Emit a UI event for a workspace."""
        channel = self._get_channel(workspace_id)

        evt = UIEvent(
            id=channel.next_id,
            at=int(time.time() * 1000),
            event=event.get("event", ""),
            data=event.get("data", {}),
        )
        channel.next_id += 1

        # Add to buffer
        channel.buffer.append(evt)
        if len(channel.buffer) > self.max_buffer:
            channel.buffer = channel.buffer[-self.max_buffer:]

        # Notify listeners
        for listener in channel.listeners:
            try:
                listener(evt)
            except Exception:
                pass

        # Persist to Redis (best effort)
        asyncio.create_task(self._persist_event(workspace_id, evt))

        return evt

    async def _persist_event(self, workspace_id: str, evt: UIEvent):
        """Persist event to Redis."""
        if not is_redis_configured():
            return

        try:
            realtime = get_realtime()
            await realtime.channel(f"ui:{workspace_id}").emit(
                evt.event,
                {
                    "id": evt.id,
                    "at": evt.at,
                    "data": evt.data,
                },
            )
        except Exception:
            pass

    def subscribe(self, workspace_id: str, listener: Listener) -> Callable[[], None]:
        """Subscribe to UI events for a workspace. Returns unsubscribe function."""
        channel = self._get_channel(workspace_id)
        channel.listeners.add(listener)

        def unsubscribe():
            channel.listeners.discard(listener)

        return unsubscribe

    def get_since(self, workspace_id: str, after_id: int) -> list[UIEvent]:
        """Get events after a specific ID."""
        channel = self._get_channel(workspace_id)
        return [e for e in channel.buffer if e.id > after_id]


# Global singleton
_workspace_ui_bus: Optional[WorkspaceUIBus] = None


def get_workspace_ui_bus() -> WorkspaceUIBus:
    """Get the workspace UI bus singleton."""
    global _workspace_ui_bus
    if _workspace_ui_bus is None:
        _workspace_ui_bus = WorkspaceUIBus()
    return _workspace_ui_bus
