"""
搜索路由模块

提供工作空间内 Agent 和群组的搜索功能
支持按名称、ID、角色等字段进行模糊搜索
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..storage.store import store

router = APIRouter()


@router.get("/search")
async def search(
    workspaceId: str = Query(...),
    agentId: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
):
    """
    搜索 Agent 和群组
    
    在指定工作空间内搜索匹配的 Agent 和群组
    
    Args:
        workspaceId: 工作空间ID，必填
        agentId: Agent ID，可选，用于过滤该 Agent 所在的群组
        q: 搜索关键词，可选，匹配 role/name/id
        limit: 返回结果数量限制，默认 20，最大 50
    
    Returns:
        dict: 包含 agents 和 groups 数组的响应
    
    Raises:
        HTTPException 400: 缺少 workspaceId
    """
    workspace_id = workspaceId.strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})

    query = (q or "").strip().lower()

    # Search agents
    agents = store.list_agents_meta(workspace_id)
    agent_results = []
    for a in agents:
        if a.get("id") and a.get("role"):
            if not query or query in a["role"].lower() or query in a["id"].lower():
                agent_results.append({
                    "id": a["id"],
                    "role": a["role"],
                    "parentId": a.get("parentId"),
                    "createdAt": a["createdAt"],
                })
        if len(agent_results) >= limit:
            break

    # Build agent role map
    agent_role_by_id = {a["id"]: a["role"] for a in agents}

    # Search groups
    groups = store.list_groups(
        workspace_id=workspace_id,
        agent_id=agentId if agentId else None,
    )
    group_results = []
    for g in groups:
        if not query:
            group_results.append(g)
        else:
            name_match = query in (g.get("name") or "").lower()
            id_match = query in g["id"].lower()
            member_match = any(
                query in agent_role_by_id.get(mid, mid).lower()
                for mid in g.get("memberIds", [])
            )
            if name_match or id_match or member_match:
                group_results.append(g)
        if len(group_results) >= limit:
            break

    return {
        "agents": agent_results,
        "groups": group_results,
    }
