"""
工作空间路由模块

提供工作空间的增删改查功能，工作空间是系统的顶层容器，
包含 Agent、群组、消息等资源
"""

from fastapi import APIRouter, HTTPException

from ..schemas.workspace import (
    WorkspaceCreate,
    WorkspaceListResponse,
    WorkspaceWithDefaultsResponse,
    WorkspaceDeleteResponse,
)
from ..storage.store import store

router = APIRouter()


@router.get("/workspaces", response_model=WorkspaceListResponse)
async def list_workspaces():
    """
    获取所有工作空间列表
    
    Returns:
        WorkspaceListResponse: 包含 workspaces 数组的响应
    
    Raises:
        HTTPException 500: 数据库未就绪或查询失败
    """
    try:
        workspaces = store.list_workspaces()
        return {"workspaces": workspaces}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Database not ready",
                "message": str(e),
                "hint": "Run POST /api/admin/init-db first",
            },
        )


@router.post("/workspaces", response_model=WorkspaceWithDefaultsResponse, status_code=201)
async def create_workspace(body: WorkspaceCreate = None):
    """
    创建新工作空间并初始化默认配置
    
    创建工作空间时会自动创建默认的 Human Agent 和初始群组
    
    Args:
        body: 包含 name 字段的请求体，可选，默认为 "Default Workspace"
    
    Returns:
        WorkspaceWithDefaultsResponse: 包含工作空间ID、默认Agent、默认群组的响应
    
    Raises:
        HTTPException 500: 创建失败
    """
    try:
        name = body.name if body else "Default Workspace"
        result = store.create_workspace_with_defaults(name)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Failed to create workspace",
                "message": str(e),
            },
        )


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str):
    """
    删除指定工作空间
    
    删除工作空间会级联删除其下所有 Agent、群组和消息
    
    Args:
        workspace_id: 工作空间ID
    
    Returns:
        dict: 删除结果
    
    Raises:
        HTTPException 400: 缺少 workspaceId
        HTTPException 500: 删除失败
    """
    workspace_id = workspace_id.strip()
    if not workspace_id:
        raise HTTPException(status_code=400, detail={"error": "Missing workspaceId"})

    try:
        result = store.delete_workspace(workspace_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.get("/workspaces/{workspace_id}/defaults", response_model=WorkspaceWithDefaultsResponse)
async def get_workspace_defaults(workspace_id: str):
    """
    获取或创建工作空间的默认配置
    
    如果工作空间尚未初始化默认配置，会自动创建
    
    Args:
        workspace_id: 工作空间ID
    
    Returns:
        WorkspaceWithDefaultsResponse: 包含 humanAgentId 和 defaultGroupId 的响应
    
    Raises:
        HTTPException 404: 工作空间不存在
        HTTPException 500: 操作失败
    """
    try:
        result = store.ensure_workspace_defaults(workspace_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})
