"""SSE Event Pydantic schemas."""

from typing import Any, Optional
from pydantic import BaseModel


class SSEEvent(BaseModel):
    """Base SSE event."""
    event: str
    data: Any


class AgentWakeupData(BaseModel):
    """Data for agent.wakeup event."""
    agentId: str
    reason: Optional[str] = None


class AgentUnreadBatch(BaseModel):
    """Unread batch for agent.unread event."""
    groupId: str
    messageIds: list[str]


class AgentUnreadData(BaseModel):
    """Data for agent.unread event."""
    agentId: str
    batches: list[AgentUnreadBatch]


class AgentStreamData(BaseModel):
    """Data for agent.stream event."""
    kind: str  # "reasoning" | "content" | "tool_calls" | "tool_result"
    delta: str
    tool_call_id: Optional[str] = None
    tool_call_name: Optional[str] = None


class AgentDoneData(BaseModel):
    """Data for agent.done event."""
    finishReason: Optional[str] = None


class AgentErrorData(BaseModel):
    """Data for agent.error event."""
    message: str


class UIAgentCreatedData(BaseModel):
    """Data for ui.agent.created event."""
    workspaceId: str
    agent: dict


class UIGroupCreatedData(BaseModel):
    """Data for ui.group.created event."""
    workspaceId: str
    group: dict


class UIMessageCreatedData(BaseModel):
    """Data for ui.message.created event."""
    workspaceId: str
    groupId: str
    memberIds: Optional[list[str]] = None
    message: dict


class UIDbWriteData(BaseModel):
    """Data for ui.db.write event."""
    workspaceId: str
    table: str
    action: str  # "insert" | "update" | "delete"
    recordId: Optional[str] = None
