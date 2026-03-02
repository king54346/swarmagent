"""Message Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class MessageCreate(BaseModel):
    """Request body for creating a message."""
    senderId: str
    content: str
    contentType: Optional[str] = "text"


class MessageResponse(BaseModel):
    """Response for a single message."""
    id: str
    senderId: str
    content: str
    contentType: str
    sendTime: str


class MessageListResponse(BaseModel):
    """Response for listing messages."""
    messages: list[MessageResponse]


class MessageSendResponse(BaseModel):
    """Response for sending a message."""
    id: str
    sendTime: str
