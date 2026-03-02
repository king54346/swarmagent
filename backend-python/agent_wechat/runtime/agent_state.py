"""LangGraph Agent State definitions."""

from typing import Annotated, Any, Optional, TypedDict
from operator import add


class ToolCallEntry(TypedDict):
    """A single tool call."""
    id: str
    name: str
    arguments: dict[str, Any]


class ToolResultEntry(TypedDict):
    """A tool execution result."""
    tool_call_id: str
    name: str
    content: str


class HistoryMessage(TypedDict, total=False):
    """A message in the conversation history."""
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    tool_calls: Optional[list[dict]]
    tool_call_id: Optional[str]
    name: Optional[str]
    reasoning_content: Optional[str]


class AgentState(TypedDict, total=False):
    """LangGraph agent state.

    Attributes:
        agent_id: The agent's UUID
        workspace_id: The workspace UUID
        group_id: Current group being processed
        history: Conversation history (accumulated)
        pending_tool_calls: Tool calls waiting to be executed
        tool_results: Results from tool execution (accumulated)
        round: Current round number (max 3)
        content: Accumulated assistant response content
        reasoning: Accumulated reasoning/thinking content
        error: Error message if any
        finish_reason: LLM finish reason
    """
    agent_id: str
    workspace_id: str
    group_id: str
    history: Annotated[list[HistoryMessage], add]
    pending_tool_calls: list[ToolCallEntry]
    tool_results: Annotated[list[ToolResultEntry], add]
    round: int
    content: str
    reasoning: str
    error: Optional[str]
    finish_reason: Optional[str]


class AgentInput(TypedDict):
    """Input to start agent processing."""
    agent_id: str
    workspace_id: str
    group_id: str
    unread_messages: list[dict]


class AgentOutput(TypedDict, total=False):
    """Output from agent processing."""
    content: str
    reasoning: str
    tool_calls: list[ToolCallEntry]
    finish_reason: str
    error: Optional[str]
