"""LangGraph Agent Graph definition."""

import json
import logging
from typing import Any, Literal

from langgraph.graph import StateGraph, END

from ..ai.llm_client import stream_llm
from ..ai.tools import create_agent_tools, BUILTIN_TOOL_NAMES
from .agent_state import AgentState, ToolCallEntry, ToolResultEntry
from .mcp_registry import get_mcp_registry

logger = logging.getLogger(__name__)


MAX_TOOL_ROUNDS = 100


def build_system_prompt(agent_id: str, workspace_id: str, role: str) -> str:
    """Build the system prompt for an agent."""
    return (
        f"你是一个 IM 系统中的智能助手。\n"
        f"你的 agent_id 是: {agent_id}\n"
        f"你的 workspace_id 是: {workspace_id}\n"
        f"你的角色是: {role}\n"
        f"\n"
        f"回复规则：\n"
        f"1. 直接用中文回复用户的消息，不要说'我需要调用工具'这类的话\n"
        f"2. 保持简洁友好，直接回答问题\n"
        f"3. 如果消息不是给你的，或者是'暂停'、'停止'等指令，不要回复\n"
        f"4. 你的回复会自动发送到群组\n"
        f"\n"
        f"可用工具（仅在需要时使用）：\n"
        f"- 查询信息: self_info, list_agents, list_groups, list_group_members, get_group_messages\n"
        f"- 发送消息: send_group_message, send_direct_message\n"
        f"- 创建代理: create_agent(role='角色名') - 必须提供 role 参数，如 create_agent(role='CTO')\n"
        f"- 创建群组: create_group\n"
        f"- 执行命令: bash\n"
        f"\n"
        f"重要：调用工具时必须提供所有必需参数。例如创建代理时必须指定 role 参数。\n"
    )


async def get_all_tools(agent_id: str, workspace_id: str) -> list:
    """Get all available tools for an agent (builtin + MCP)."""
    # Get builtin tools
    builtin_tools = create_agent_tools(agent_id, workspace_id)

    # Get MCP tools
    mcp = await get_mcp_registry(BUILTIN_TOOL_NAMES)
    mcp_tools = mcp.get_tool_definitions()

    # Combine tools
    return builtin_tools + mcp_tools


async def agent_node(state: AgentState) -> dict:
    """调用 LLM，返回工具调用或最终响应"""
    agent_id = state["agent_id"]
    workspace_id = state["workspace_id"]
    history = state.get("history", [])
    current_round = state.get("round", 0)

    # Check max rounds
    if current_round >= MAX_TOOL_ROUNDS:
        return {
            "finish_reason": "max_rounds",
            "pending_tool_calls": [],
        }

    # 1. 获取所有可用工具 (内置 + MCP)
    tools = await get_all_tools(agent_id, workspace_id)

    # Convert tools to OpenAI format for LangChain
    tool_schemas = []
    for tool in tools:
        if hasattr(tool, "name"):
            # LangChain tool object
            tool_schemas.append(tool)
        elif isinstance(tool, dict) and "function" in tool:
            # Already in OpenAI format
            tool_schemas.append(tool)

    # Prepare content and tool calls accumulators
    content_parts = []
    reasoning_parts = []
    tool_calls_raw: list[dict] = []

    def on_content(delta: str):
        content_parts.append(delta)

    def on_tool_call(tc: dict):
        # Accumulate tool call deltas
        tc_id = tc.get("id", "")
        tc_name = tc.get("name", "")
        tc_args_delta = tc.get("arguments_delta", "")

        # Find or create entry
        existing = None
        for entry in tool_calls_raw:
            if entry["id"] == tc_id:
                existing = entry
                break

        if existing:
            if tc_args_delta:
                existing["arguments"] += tc_args_delta
        else:
            tool_calls_raw.append({
                "id": tc_id,
                "name": tc_name,
                "arguments": tc_args_delta,
            })

    # 2. 调用 LLM 流式生成
    result = await stream_llm(
        messages=history,
        tools=tool_schemas if tool_schemas else None,
        on_content=on_content,
        on_tool_call=on_tool_call,
    )

    content = "".join(content_parts) or result.get("content", "")
    tool_calls = result.get("tool_calls", [])

    # Convert to ToolCallEntry format
    pending_tool_calls: list[ToolCallEntry] = []
    for tc in tool_calls:
        args = tc.get("arguments", {})
        tc_name = tc.get("name", "")
        tc_id = tc.get("id", "")
        
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse tool call arguments for {tc_name}: {args}, error: {e}")
                # Keep as string for better error message
                args = {"_raw_args": args, "_parse_error": str(e)}
        
        logger.info(f"Tool call prepared: name={tc_name}, args={args}")
        pending_tool_calls.append({
            "id": tc_id,
            "name": tc_name,
            "arguments": args,
        })
    # 3. 返回内容和工具调用
    return {
        "content": content,
        "pending_tool_calls": pending_tool_calls,
        "finish_reason": result.get("finish_reason", "stop"),
        "round": current_round + 1,
    }


async def tools_node(state: AgentState) -> dict:
    """执行待处理的工具调用"""
    agent_id = state["agent_id"]
    workspace_id = state["workspace_id"]
    pending_tool_calls = state.get("pending_tool_calls", [])
    history = state.get("history", [])

    if not pending_tool_calls:
        return {"tool_results": [], "pending_tool_calls": []}

    # Get tools
    builtin_tools = create_agent_tools(agent_id, workspace_id)
    tool_map = {t.name: t for t in builtin_tools if hasattr(t, "name")}

    # Get MCP registry
    mcp = await get_mcp_registry(BUILTIN_TOOL_NAMES)

    results: list[ToolResultEntry] = []

    # Add assistant message with tool calls to history
    assistant_msg = {
        "role": "assistant",
        "content": state.get("content", ""),
        "tool_calls": [
            {
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": json.dumps(tc["arguments"]),
                },
            }
            for tc in pending_tool_calls
        ],
    }

    for tc in pending_tool_calls:
        tool_name = tc["name"]
        tool_args = tc["arguments"]
        
        logger.info(f"Executing tool: {tool_name} with args: {tool_args}")

        try:
            # Check for parse error in args
            if isinstance(tool_args, dict) and "_parse_error" in tool_args:
                result = {"ok": False, "error": f"Invalid arguments: {tool_args.get('_raw_args', '')}"}
            # Try builtin tool first
            elif tool_name in tool_map:
                tool_fn = tool_map[tool_name]
                # LangChain tools are sync, invoke directly
                result = tool_fn.invoke(tool_args)
            elif mcp.has_tool(tool_name):
                # Try MCP tool
                result = await mcp.call_tool(tool_name, tool_args)
            else:
                result = {"ok": False, "error": f"Unknown tool: {tool_name}"}

            logger.info(f"Tool {tool_name} result: {result}")
            result_str = json.dumps(result) if isinstance(result, dict) else str(result)
        except Exception as e:
            logger.exception(f"Tool {tool_name} execution failed: {e}")
            result_str = json.dumps({"ok": False, "error": str(e)})

        results.append({
            "tool_call_id": tc["id"],
            "name": tool_name,
            "content": result_str,
        })

    # Build tool messages for history
    tool_messages = [
        {
            "role": "tool",
            "content": r["content"],
            "tool_call_id": r["tool_call_id"],
            "name": r["name"],
        }
        for r in results
    ]

    return {
        "tool_results": results,
        "pending_tool_calls": [],
        "history": [assistant_msg] + tool_messages,
    }


def should_continue(state: AgentState) -> Literal["tools", "end"]:
    """判断是否继续执行工具"""
    pending_tool_calls = state.get("pending_tool_calls", [])
    current_round = state.get("round", 0)

    if pending_tool_calls and current_round < MAX_TOOL_ROUNDS:
        return "tools"
    return "end"


def create_agent_graph() -> StateGraph:
    """Create the LangGraph agent graph.

    Graph structure:
        Entry -> agent_node -> conditional:
            ├─ has tool_calls -> tools_node -> agent_node (loop, max 3 rounds)
            └─ no tool_calls -> END
    """
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)

    # Set entry point
    graph.set_entry_point("agent")

    # Add conditional edge from agent
    graph.add_conditional_edges(
        "agent",
        should_continue,
        {
            "tools": "tools",
            "end": END,
        },
    )

    # Tools always goes back to agent
    graph.add_edge("tools", "agent")

    return graph


# Compiled graph singleton
_compiled_graph = None


def get_agent_graph():
    """Get the compiled agent graph."""
    global _compiled_graph
    if _compiled_graph is None:
        graph = create_agent_graph()
        _compiled_graph = graph.compile()
    return _compiled_graph
