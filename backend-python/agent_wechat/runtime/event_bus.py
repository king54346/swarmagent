"""Agent event bus for streaming agent events."""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .redis_realtime import get_realtime, is_redis_configured


@dataclass
class AgentEvent:
    """An event from an agent."""
    id: int
    at: int  # timestamp in ms
    event: str
    data: dict


@dataclass
class ChannelState:
    """State for an agent channel."""
    next_id: int = 1
    buffer: list[AgentEvent] = field(default_factory=list)
    listeners: set = field(default_factory=set)
    persist_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


Listener = Callable[[AgentEvent], None]

DEFAULT_MAX_BUFFER = 2000


class AgentEventBus:
    """Event bus for agent events."""

    def __init__(self, max_buffer: int = DEFAULT_MAX_BUFFER):
        self.max_buffer = max_buffer
        self._channels: dict[str, ChannelState] = {}

    def _get_channel(self, agent_id: str) -> ChannelState:
        """Get or create a channel for an agent."""
        if agent_id not in self._channels:
            self._channels[agent_id] = ChannelState()
        return self._channels[agent_id]

    def emit(self, agent_id: str, event: dict) -> AgentEvent:
        """Emit an event for an agent."""
        channel = self._get_channel(agent_id)

        evt = AgentEvent(
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
        asyncio.create_task(self._persist_event(agent_id, evt))

        return evt

    async def _persist_event(self, agent_id: str, evt: AgentEvent):
        """Persist event to Redis."""
        if not is_redis_configured():
            return

        channel = self._get_channel(agent_id)
        async with channel.persist_lock:
            try:
                realtime = get_realtime()
                await realtime.channel(f"agent:{agent_id}").emit(
                    evt.event,
                    {
                        "id": evt.id,
                        "at": evt.at,
                        "data": evt.data,
                    },
                )
            except Exception:
                pass

    def subscribe(self, agent_id: str, listener: Listener) -> Callable[[], None]:
        """Subscribe to events for an agent. Returns unsubscribe function."""
        channel = self._get_channel(agent_id)
        channel.listeners.add(listener)

        def unsubscribe():
            channel.listeners.discard(listener)

        return unsubscribe

    def get_since(self, agent_id: str, after_id: int) -> list[AgentEvent]:
        """Get events after a specific ID."""
        channel = self._get_channel(agent_id)
        return [e for e in channel.buffer if e.id > after_id]

    def get_latest_id(self, agent_id: str) -> int:
        """Get the latest event ID for an agent."""
        channel = self._get_channel(agent_id)
        return channel.next_id - 1


# Global singleton
_agent_event_bus: Optional[AgentEventBus] = None


def get_agent_event_bus() -> AgentEventBus:
    """Get the agent event bus singleton."""
    global _agent_event_bus
    if _agent_event_bus is None:
        _agent_event_bus = AgentEventBus()
    return _agent_event_bus
