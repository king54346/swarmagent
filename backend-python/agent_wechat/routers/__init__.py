"""API routers module."""

from . import (
    admin,
    agent_graph,
    agents,
    config_routes,
    groups,
    health,
    llm_stream,
    messages,
    search,
    sse,
    workspaces,
)

__all__ = [
    "admin",
    "agent_graph",
    "agents",
    "config_routes",
    "groups",
    "health",
    "llm_stream",
    "messages",
    "search",
    "sse",
    "workspaces",
]
