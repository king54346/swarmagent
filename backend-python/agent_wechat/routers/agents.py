"""
Agent 路由模块

提供 AI 代理（Agent）的增删改查功能
Agent 是系统中的智能体，可以是人类用户或 AI 助手
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..schemas.agent import (
    AgentCreate,
    AgentCreateResponse,
    AgentDeleteResponse,
    AgentListFullResponse,
    AgentListMetaResponse,
    AgentResponse,
)
from ..storage.store import store

router = APIRouter()


@router.get("/agents")
async def list_agents(
    workspaceId: Optional[str] = Query(None),
    meta: bool = Query(False),
):
    """
    获取工作空间内的 Agent 列表
    
    Args:
        workspaceId: 工作空间ID，必填
        meta: 是否只返回元数据（不包含 llmHistory），默认 False
    
    Returns:
        dict: 包含 agents 数组的响应
    
    Raises:
        HTTPException 400: 缺少 workspaceId
    """
    if not workspaceId:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})

    if meta:
        agents = store.list_agents_meta(workspaceId)
        return {"agents": agents}
    else:
        agents = store.list_agents(workspaceId)
        return {"agents": agents}


@router.post("/agents", status_code=201)
async def create_agent(body: AgentCreate):
    """
    创建新的 AI Agent
    
    创建 Agent 时会自动创建与 Human Agent 的 P2P 私聊群组
    
    Args:
        body: 包含 workspaceId, creatorId, role, guidance, groupId 的请求体
    
    Returns:
        dict: 包含 agentId, groupId, createdAt 的响应
    
    Raises:
        HTTPException 400: 缺少必填字段
        HTTPException 500: 创建失败
    """
    workspace_id = body.workspaceId.strip() if body.workspaceId else None
    creator_id = body.creatorId.strip() if body.creatorId else None
    role = body.role.strip() if body.role else None

    if not workspace_id:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})
    if not creator_id:
        raise HTTPException(status_code=400, detail={"error": "Missing creatorId"})
    if not role:
        raise HTTPException(status_code=400, detail={"error": "Missing role"})

    try:
        # Ensure workspace defaults
        defaults = store.ensure_workspace_defaults(workspace_id)
        human_agent_id = defaults["humanAgentId"]

        # Create sub-agent with P2P group
        created = store.create_sub_agent_with_p2p(
            workspace_id=workspace_id,
            creator_id=creator_id,
            role=role,
            guidance=body.guidance,
        )

        # If groupId provided, add agent to that group too
        if body.groupId:
            store.add_group_members(body.groupId, [created["agentId"]])

        return {
            "agentId": created["agentId"],
            "groupId": body.groupId or created["groupId"],
            "createdAt": created["createdAt"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    """
    根据 ID 获取 Agent 详情
    
    Args:
        agent_id: Agent ID
    
    Returns:
        dict: 包含 agentId, role, llmHistory 的响应
    
    Raises:
        HTTPException 400: 缺少 agentId
        HTTPException 404: Agent 不存在
    """
    agent_id = agent_id.strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail={"error": "Missing agentId"})

    try:
        agent = store.get_agent(agent_id)
        return {
            "agentId": agent["id"],
            "role": agent["role"],
            "llmHistory": agent["llmHistory"],
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """
    删除指定 Agent
    
    注意：Human Agent 不允许删除，删除 Agent 会级联删除其专属的 P2P 群组
    
    Args:
        agent_id: Agent ID
    
    Returns:
        dict: 包含 success, deletedAgentId, deletedGroupsCount 的响应
    
    Raises:
        HTTPException 400: 缺少 agentId
        HTTPException 403: 不允许删除 Human Agent
        HTTPException 404: Agent 不存在
        HTTPException 500: 删除失败
    """
    agent_id = agent_id.strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail={"error": "Missing agentId"})

    try:
        agent = store.get_agent(agent_id)
        if agent["role"] == "human":
            raise HTTPException(status_code=403, detail={"error": "Cannot delete human agent"})

        result = store.delete_agent(agent_id)
        return {
            "success": True,
            "deletedAgentId": result["deletedAgentId"],
            "deletedGroupsCount": result["deletedGroupsCount"],
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})
