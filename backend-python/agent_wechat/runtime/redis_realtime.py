"""Redis Streams 核心封装，提供 RealtimeChannel 和 RealtimeClient"""

import asyncio
import json
import uuid
from typing import Any, Callable, Optional

import redis.asyncio as redis

from ..config import get_settings

_redis_client: Optional[redis.Redis] = None


def get_redis_url() -> str:
    """Get Redis URL from settings."""
    return get_settings().redis_url


def is_redis_configured() -> bool:
    """Check if Redis is configured."""
    return bool(get_redis_url())


async def get_redis_client() -> redis.Redis:
    """Get or create Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(get_redis_url())
    return _redis_client


async def close_redis_client():
    """Close Redis client."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


class RealtimeChannel:
    """A realtime channel backed by Redis Streams."""

    def __init__(self, name: str):
        self.name = name
        self.stream_key = name

    async def emit(self, event: str, payload: Any) -> str:
        """Emit an event to the channel. Returns the message ID."""
        client = await get_redis_client()
        data = json.dumps(payload) if payload is not None else "null"
        msg_id = await client.xadd(
            self.stream_key,
            {"event": event, "data": data},
        )
        # Publish notification for subscribers
        await client.publish(self.stream_key, "1")
        return msg_id

    async def subscribe(
        self,
        events: list[str],
        on_data: Callable[[dict], None],
        history_start: Optional[str] = None,
        history_limit: int = 2000,
    ) -> Callable[[], None]:
        """
        Subscribe to events on this channel.

        Returns an unsubscribe function.
        """
        client = await get_redis_client()
        subscriber = client.pubsub()

        # Create consumer group
        group = f"sse-{uuid.uuid4()}"
        consumer = f"c-{uuid.uuid4()}"
        start_id = "0" if history_start == "-" else "$"

        try:
            await client.xgroup_create(
                self.stream_key, group, start_id, mkstream=True
            )
        except redis.ResponseError:
            # Group may already exist
            pass

        # Read history if requested
        if history_start == "-":
            await self._read_group(client, group, consumer, events, on_data)

        # Subscribe to notifications
        await subscriber.subscribe(self.stream_key)

        # Background task to read messages
        running = True

        async def reader():
            while running:
                try:
                    message = await subscriber.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if message:
                        await self._read_group(client, group, consumer, events, on_data)
                except Exception:
                    if running:
                        await asyncio.sleep(0.1)

        task = asyncio.create_task(reader())

        async def unsubscribe():
            nonlocal running
            running = False
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await subscriber.unsubscribe(self.stream_key)
            await subscriber.close()
            try:
                await client.xgroup_destroy(self.stream_key, group)
            except Exception:
                pass

        return unsubscribe

    async def _read_group(
        self,
        client: redis.Redis,
        group: str,
        consumer: str,
        events: list[str],
        on_data: Callable[[dict], None],
    ):
        """Read messages from consumer group."""
        try:
            messages = await client.xreadgroup(
                group, consumer, {self.stream_key: ">"}, count=2000
            )
            if not messages:
                return

            for stream_name, entries in messages:
                for msg_id, fields in entries:
                    event = fields.get(b"event", fields.get("event", b"")).decode() if isinstance(fields.get(b"event", fields.get("event", b"")), bytes) else fields.get(b"event", fields.get("event", ""))
                    if events and event not in events:
                        continue

                    raw_data = fields.get(b"data", fields.get("data", b"null"))
                    if isinstance(raw_data, bytes):
                        raw_data = raw_data.decode()

                    try:
                        payload = json.loads(raw_data)
                    except json.JSONDecodeError:
                        payload = raw_data

                    on_data({
                        "id": msg_id.decode() if isinstance(msg_id, bytes) else msg_id,
                        "event": event,
                        "data": payload,
                    })
        except Exception:
            pass


class RealtimeClient:
    """Client for realtime communication."""

    def channel(self, name: str) -> RealtimeChannel:
        """Get a channel by name."""
        return RealtimeChannel(name)


_realtime_client: Optional[RealtimeClient] = None


def get_realtime() -> RealtimeClient:
    """Get the realtime client singleton."""
    global _realtime_client
    if _realtime_client is None:
        _realtime_client = RealtimeClient()
    return _realtime_client
