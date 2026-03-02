"""Group Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class GroupCreate(BaseModel):
    """Request body for creating a group."""
    workspaceId: str
    memberIds: list[str]
    name: Optional[str] = None


class LastMessage(BaseModel):
    """Last message in a group."""
    content: str
    contentType: str
    sendTime: str
    senderId: str


class GroupResponse(BaseModel):
    """Response for a single group."""
    id: str
    name: Optional[str] = None
    memberIds: list[str]
    unreadCount: int = 0
    contextTokens: int = 0
    lastMessage: Optional[LastMessage] = None
    updatedAt: str
    createdAt: str


class GroupListResponse(BaseModel):
    """Response for listing groups."""
    groups: list[GroupResponse]


class GroupCreateResponse(BaseModel):
    """Response for creating a group."""
    id: str
    name: Optional[str] = None
