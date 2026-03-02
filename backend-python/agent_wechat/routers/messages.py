"""
消息路由模块

提供群组内消息的发送和查询功能
发送消息时会触发 UI 事件推送和 Agent 唤醒
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..schemas.message import MessageCreate, MessageListResponse, MessageSendResponse
from ..storage.store import store
from ..runtime.agent_runtime import get_agent_runtime
from ..runtime.ui_bus import get_workspace_ui_bus

router = APIRouter()


@router.get("/groups/{group_id}/messages", response_model=MessageListResponse)
async def list_messages(
    group_id: str,
    markRead: bool = Query(False),
    readerId: Optional[str] = Query(None),
):
    """
    获取群组内的消息列表
    
    Args:
        group_id: 群组ID
        markRead: 是否标记为已读，默认 False
        readerId: 读取者 Agent ID，配合 markRead 使用
    
    Returns:
        MessageListResponse: 包含 messages 数组的响应
    """
    messages = store.list_messages(group_id)

    if markRead and readerId:
        store.mark_group_read(group_id, readerId)

    return {"messages": messages}


@router.post("/groups/{group_id}/messages", response_model=MessageSendResponse, status_code=201)
async def send_message(group_id: str, body: MessageCreate):
    """
    向群组发送消息
    
    发送消息后会：
    1. 通过 UI 事件总线推送消息创建事件
    2. 唤醒群组内的其他 Agent 进行响应
    
    Args:
        group_id: 群组ID
        body: 包含 senderId, content, contentType 的请求体
    
    Returns:
        MessageSendResponse: 包含 id 和 sendTime 的响应
    
    Raises:
        HTTPException 404: 群组不存在
        HTTPException 500: 发送失败
    """
    try:
        result = store.send_message(
            group_id=group_id,
            sender_id=body.senderId,
            content=body.content,
            content_type=body.contentType or "text",
        )

        # Get workspace and emit UI event
        try:
            workspace_id = store.get_group_workspace_id(group_id)
            member_ids = store.list_group_member_ids(group_id)

            ui_bus = get_workspace_ui_bus()
            ui_bus.emit(workspace_id, {
                "event": "ui.message.created",
                "data": {
                    "workspaceId": workspace_id,
                    "groupId": group_id,
                    "memberIds": member_ids,
                    "message": {
                        "id": result["id"],
                        "senderId": body.senderId,
                        "sendTime": result["sendTime"],
                    },
                },
            })

            # Wake agents in the group
            runtime = get_agent_runtime()
            await runtime.wake_agents_for_group(group_id, body.senderId)
        except Exception as e:
            # Best effort - don't fail the request if events/wake fails
            import logging
            logging.getLogger(__name__).warning(f"Failed to wake agents: {e}", exc_info=True)

        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})
