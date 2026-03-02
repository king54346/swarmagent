"""
群组路由模块

提供聊天群组的增删改查功能
群组是消息的容器，支持 P2P 私聊和多人群聊
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..schemas.group import GroupCreate, GroupCreateResponse, GroupListResponse
from ..storage.store import store

router = APIRouter()


@router.get("/groups", response_model=GroupListResponse)
async def list_groups(
    workspaceId: Optional[str] = Query(None),
    agentId: Optional[str] = Query(None),
):
    """
    获取群组列表
    
    可以按工作空间或 Agent 进行过滤
    
    Args:
        workspaceId: 工作空间ID，可选
        agentId: Agent ID，可选，返回该 Agent 所在的群组
    
    Returns:
        GroupListResponse: 包含 groups 数组的响应
    """
    groups = store.list_groups(
        workspace_id=workspaceId,
        agent_id=agentId,
    )
    return {"groups": groups}


@router.post("/groups", response_model=GroupCreateResponse, status_code=201)
async def create_group(body: GroupCreate):
    """
    创建新群组
    
    如果是两人群组（P2P），会尝试合并重复的群组
    
    Args:
        body: 包含 workspaceId, memberIds, name 的请求体
    
    Returns:
        GroupCreateResponse: 包含 id 和 name 的响应
    """
    if len(body.memberIds) == 2:
        # Try to merge P2P groups
        group_id = store.merge_duplicate_exact_p2p_groups(
            workspace_id=body.workspaceId,
            member_a=body.memberIds[0],
            member_b=body.memberIds[1],
            preferred_name=body.name,
        )
        if not group_id:
            result = store.create_group(
                workspace_id=body.workspaceId,
                member_ids=body.memberIds,
                name=body.name,
            )
            group_id = result["id"]
        return {"id": group_id, "name": body.name}

    result = store.create_group(
        workspace_id=body.workspaceId,
        member_ids=body.memberIds,
        name=body.name,
    )
    return {"id": result["id"], "name": result["name"]}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str):
    """
    删除指定群组
    
    删除群组会级联删除群组内的所有消息
    
    Args:
        group_id: 群组ID
    
    Returns:
        dict: 包含 success=True 的响应
    
    Raises:
        HTTPException 404: 群组不存在
    """
    try:
        store.delete_group(group_id)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})
