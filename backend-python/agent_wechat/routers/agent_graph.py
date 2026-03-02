"""
Agent 图谱路由模块

提供 Agent 间通信关系图的查询接口
用于可视化展示 Agent 之间的消息交流关系
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..storage.store import store

router = APIRouter()


@router.get("/agent-graph")
async def get_agent_graph(
    workspaceId: str = Query(...),
    limitMessages: int = Query(2000),
):
    """
    获取 Agent 通信关系图
    
    根据最近的消息记录构建 Agent 之间的通信关系图，
    返回节点（Agent）和边（通信关系）数据
    
    Args:
        workspaceId: 工作空间ID，必填
        limitMessages: 考虑的消息数量限制，默认 2000
    
    Returns:
        dict: 包含以下字段的响应
            - nodes: Agent 节点列表，包含 id, role, parentId
            - edges: 通信边列表，包含 from, to, count, lastSendTime
            - meta: 元信息，包含统计数据
    
    Raises:
        HTTPException 400: 缺少 workspaceId
    """
    workspace_id = workspaceId.strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})

    # 获取工作空间内的所有 Agent
    agents = store.list_agents_meta(workspace_id)

    # 获取工作空间内的所有群组
    groups = store.list_groups(workspace_id=workspace_id)

    # 获取最近的消息记录用于构建通信关系
    recent_messages = store.list_recent_workspace_messages(workspace_id, limit=limitMessages)

    # 构建群组成员映射表（groupId -> memberIds）
    group_members_by_id = {g["id"]: g["memberIds"] for g in groups}

    # 根据消息记录构建通信边（from -> to）
    edge_by_key: dict[str, dict] = {}
    for m in recent_messages:
        members = group_members_by_id.get(m["groupId"], [])
        for to_id in members:
            if to_id == m["senderId"]:
                continue
            key = f"{m['senderId']}=>{to_id}"
            if key not in edge_by_key:
                edge_by_key[key] = {
                    "from": m["senderId"],
                    "to": to_id,
                    "count": 1,
                    "lastSendTime": m["sendTime"],
                }
            else:
                edge_by_key[key]["count"] += 1
                if m["sendTime"] > edge_by_key[key]["lastSendTime"]:
                    edge_by_key[key]["lastSendTime"] = m["sendTime"]

    # 构建 Agent 节点列表
    nodes = [
        {
            "id": a["id"],
            "role": a["role"],
            "parentId": a.get("parentId"),
        }
        for a in agents
    ]

    # 按最后发送时间对边进行排序（降序）
    edges = sorted(
        edge_by_key.values(),
        key=lambda x: x["lastSendTime"],
        reverse=True,
    )

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "workspaceId": workspace_id,
            "groups": len(groups),
            "agents": len(agents),
            "messagesConsidered": len(recent_messages),
        },
    }
