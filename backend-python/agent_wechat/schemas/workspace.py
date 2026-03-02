"""Workspace Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class WorkspaceCreate(BaseModel):
    """Request body for creating a workspace."""
    name: Optional[str] = "Default Workspace"


class WorkspaceResponse(BaseModel):
    """Response for a workspace."""
    id: str
    name: str
    createdAt: str


class WorkspaceListResponse(BaseModel):
    """Response for listing workspaces."""
    workspaces: list[WorkspaceResponse]


class WorkspaceWithDefaultsResponse(BaseModel):
    """Response for creating workspace with defaults."""
    workspaceId: str
    humanAgentId: str
    assistantAgentId: str
    defaultGroupId: str


class WorkspaceDeleteResponse(BaseModel):
    """Response for deleting a workspace."""
    success: bool
    deletedWorkspaceId: Optional[str] = None
