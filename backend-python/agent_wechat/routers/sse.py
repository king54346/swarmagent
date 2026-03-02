"""
SSE（Server-Sent Events）路由模块

提供实时事件推送功能，包括：
- Agent 上下文流：推送 Agent 的唤醒、未读消息、流式输出等事件
- UI 事件流：推送工作空间内的 Agent/群组/消息创建等事件
"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..runtime.redis_realtime import get_realtime, is_redis_configured
from ..runtime.event_bus import get_agent_event_bus
from ..runtime.ui_bus import get_workspace_ui_bus

router = APIRouter()


def sse_message(data: dict, event_id: Optional[str] = None) -> str:
    """
    格式化 SSE 消息
    
    Args:
        data: 消息数据
        event_id: 事件ID，可选，用于断线重连时恢复
    
    Returns:
        str: 符合 SSE 规范的格式化字符串
    """
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"data: {json.dumps(data)}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


@router.get("/agents/{agent_id}/context-stream")
async def agent_context_stream(agent_id: str):
    """
    Agent 上下文事件流
    
    通过 SSE 推送指定 Agent 的实时事件，包括：
    - agent.wakeup: Agent 被唤醒
    - agent.unread: 有未读消息
    - agent.stream: 流式输出内容
    - agent.done: 处理完成
    - agent.error: 发生错误
    
    Args:
        agent_id: Agent ID
    
    Returns:
        StreamingResponse: SSE 流式响应
    """

    async def event_generator():
        # 发送初始 ping
        yield ": ping\n\n"

        queue: asyncio.Queue = asyncio.Queue()
        unsubscribe = None

        try:
            if is_redis_configured():
                # 订阅 Redis 频道
                realtime = get_realtime()
                channel = realtime.channel(f"agent:{agent_id}")

                def on_data(evt: dict):
                    asyncio.create_task(queue.put(evt))

                unsubscribe = await channel.subscribe(
                    events=[
                        "agent.wakeup",
                        "agent.unread",
                        "agent.stream",
                        "agent.done",
                        "agent.error",
                    ],
                    on_data=on_data,
                    history_start="-",
                )
            else:
                # 使用内存事件总线
                bus = get_agent_event_bus()

                def on_event(evt):
                    asyncio.create_task(queue.put({
                        "id": str(evt.id),
                        "event": evt.event,
                        "data": evt.data,
                    }))

                unsubscribe_fn = bus.subscribe(agent_id, on_event)

                async def async_unsub():
                    unsubscribe_fn()

                unsubscribe = async_unsub

            # 通过定期 ping 保持连接存活
            ping_task = asyncio.create_task(ping_loop(queue))

            try:
                while True:
                    try:
                        evt = await asyncio.wait_for(queue.get(), timeout=30)
                        if evt.get("_ping"):
                            yield ": ping\n\n"
                        else:
                            payload = {
                                "event": evt.get("event", ""),
                                "data": evt.get("data", {}),
                            }
                            yield sse_message(payload, evt.get("id"))
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                ping_task.cancel()

        finally:
            if unsubscribe:
                if asyncio.iscoroutinefunction(unsubscribe):
                    await unsubscribe()
                else:
                    unsubscribe()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Encoding": "none",
        },
    )


@router.get("/ui-stream")
async def ui_stream(workspaceId: str = Query(...)):
    """
    工作空间 UI 事件流
    
    通过 SSE 推送工作空间内的实时 UI 事件，包括：
    - ui.agent.created: 新 Agent 创建
    - ui.group.created: 新群组创建
    - ui.message.created: 新消息创建
    - ui.agent.llm.start/done: LLM 调用开始/完成
    - ui.agent.history.persisted: 历史记录已持久化
    - ui.agent.tool_call.start/done: 工具调用开始/完成
    - ui.db.write: 数据库写入事件
    
    Args:
        workspaceId: 工作空间ID
    
    Returns:
        StreamingResponse: SSE 流式响应
    
    Raises:
        HTTPException 400: 缺少 workspaceId
    """
    if not workspaceId:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})

    async def event_generator():
        # 发送初始 ping
        yield ": ping\n\n"

        queue: asyncio.Queue = asyncio.Queue()
        unsubscribe = None

        try:
            if is_redis_configured():
                # 订阅 Redis 频道
                realtime = get_realtime()
                channel = realtime.channel(f"ui:{workspaceId}")

                def on_data(evt: dict):
                    asyncio.create_task(queue.put(evt))

                unsubscribe = await channel.subscribe(
                    events=[
                        "ui.agent.created",
                        "ui.group.created",
                        "ui.message.created",
                        "ui.agent.llm.start",
                        "ui.agent.llm.done",
                        "ui.agent.history.persisted",
                        "ui.agent.tool_call.start",
                        "ui.agent.tool_call.done",
                        "ui.db.write",
                    ],
                    on_data=on_data,
                    history_start="-",
                )
            else:
                # 使用内存事件总线
                bus = get_workspace_ui_bus()

                def on_event(evt):
                    asyncio.create_task(queue.put({
                        "id": str(evt.id),
                        "event": evt.event,
                        "data": evt.data,
                    }))

                unsubscribe_fn = bus.subscribe(workspaceId, on_event)

                async def async_unsub():
                    unsubscribe_fn()

                unsubscribe = async_unsub

            # 通过定期 ping 保持连接存活
            ping_task = asyncio.create_task(ping_loop(queue))

            try:
                while True:
                    try:
                        evt = await asyncio.wait_for(queue.get(), timeout=30)
                        if evt.get("_ping"):
                            yield ": ping\n\n"
                        else:
                            payload = {
                                "event": evt.get("event", ""),
                                "data": evt.get("data", {}),
                            }
                            yield sse_message(payload, evt.get("id"))
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                ping_task.cancel()

        finally:
            if unsubscribe:
                if asyncio.iscoroutinefunction(unsubscribe):
                    await unsubscribe()
                else:
                    unsubscribe()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Encoding": "none",
        },
    )


async def ping_loop(queue: asyncio.Queue):
    """
    定期发送 ping 保持连接存活
    
    每 15 秒发送一次 ping 消息，防止连接超时断开
    
    Args:
        queue: 事件队列，用于发送 ping 消息
    """
    while True:
        await asyncio.sleep(15)
        await queue.put({"_ping": True})
