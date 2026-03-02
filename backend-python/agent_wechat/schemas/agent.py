"""Agent Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class AgentCreate(BaseModel):
    """Request body for creating an agent."""
    workspaceId: str
    creatorId: str
    role: str
    groupId: Optional[str] = None
    guidance: Optional[str] = None


class AgentMeta(BaseModel):
    """Agent metadata (without llmHistory)."""
    id: str
    role: str
    parentId: Optional[str] = None
    createdAt: str


class AgentFull(BaseModel):
    """Full agent data including llmHistory."""
    id: str
    workspaceId: str
    role: str
    llmHistory: str


class AgentResponse(BaseModel):
    """Response for a single agent."""
    agentId: str
    role: str
    llmHistory: str


class AgentListMetaResponse(BaseModel):
    """Response for listing agents (metadata only)."""
    agents: list[AgentMeta]


class AgentListFullResponse(BaseModel):
    """Response for listing agents (full data)."""
    agents: list[AgentFull]


class AgentCreateResponse(BaseModel):
    """Response for creating an agent."""
    agentId: str
    groupId: str
    createdAt: str


class AgentDeleteResponse(BaseModel):
    """Response for deleting an agent."""
    success: bool
    deletedAgentId: str
    deletedGroupsCount: int
