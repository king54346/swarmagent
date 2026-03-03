"""LLM streaming client using LangChain."""

import json
import logging
from typing import Any, Callable, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from .providers import create_model, get_llm_provider

logger = logging.getLogger(__name__)


def convert_messages(history: list[dict]) -> list[BaseMessage]:
    """Convert history format to LangChain messages."""
    messages = []

    for msg in history:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "system":
            if content and content.strip():
                messages.append(SystemMessage(content=content))

        elif role == "user":
            if content and content.strip():
                messages.append(HumanMessage(content=content))

        elif role == "assistant":
            # Check for tool calls
            tool_calls = msg.get("tool_calls", [])
            if tool_calls:
                # Format tool calls for LangChain
                lc_tool_calls = []
                for tc in tool_calls:
                    func = tc.get("function", {})
                    args = func.get("arguments", "{}")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    lc_tool_calls.append({
                        "id": tc.get("id", ""),
                        "name": func.get("name", ""),
                        "args": args,
                    })
                messages.append(AIMessage(
                    content=content or "",
                    tool_calls=lc_tool_calls,
                ))
            elif content and content.strip():
                messages.append(AIMessage(content=content))

        elif role == "tool":
            tool_call_id = msg.get("tool_call_id", "")
            name = msg.get("name", "")
            messages.append(ToolMessage(
                content=content or "null",
                tool_call_id=tool_call_id,
                name=name,
            ))

    return messages


async def stream_llm(
    messages: list[dict],
    tools: Optional[list] = None,
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
    on_content: Optional[Callable[[str], None]] = None,
    on_tool_call: Optional[Callable[[dict], None]] = None,
    on_finish: Optional[Callable[[dict], None]] = None,
) -> dict:
    """
    Stream LLM response.

    Returns:
        dict with keys: content, tool_calls, finish_reason, usage
    """
    model = create_model(provider, model_name)

    # Bind tools if provided
    if tools:
        model = model.bind_tools(tools)

    # Convert messages
    lc_messages = convert_messages(messages)

    # Stream response
    content = ""
    tool_calls = []

    async for chunk in model.astream(lc_messages):
        # Log raw chunk for debugging
        logger.info(f"LLM chunk received: type={type(chunk).__name__}")
        
        # Handle content
        if hasattr(chunk, "content") and chunk.content:
            delta = chunk.content
            content += delta
            if on_content:
                on_content(delta)

        # Handle tool calls - check multiple possible attributes
        tool_call_data = None
        if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
            tool_call_data = chunk.tool_call_chunks
            logger.info(f"Found tool_call_chunks: {tool_call_data}")
        elif hasattr(chunk, "tool_calls") and chunk.tool_calls:
            # Some models use tool_calls instead of tool_call_chunks
            tool_call_data = chunk.tool_calls
            logger.info(f"Found tool_calls: {tool_call_data}")
        elif hasattr(chunk, "additional_kwargs"):
            ak = chunk.additional_kwargs
            if "tool_calls" in ak:
                tool_call_data = ak["tool_calls"]
                logger.info(f"Found tool_calls in additional_kwargs: {tool_call_data}")
        
        if tool_call_data:
            for tc_chunk in tool_call_data:
                # Handle both dict and object formats
                if hasattr(tc_chunk, "get"):
                    tc_index = tc_chunk.get("index", 0)
                    tc_id = tc_chunk.get("id") or ""
                    tc_name = tc_chunk.get("name") or ""
                    tc_args = tc_chunk.get("args") or tc_chunk.get("arguments") or ""
                    # Check nested function format
                    if not tc_args and "function" in tc_chunk:
                        func = tc_chunk["function"]
                        tc_name = tc_name or func.get("name", "")
                        tc_args = func.get("arguments", "")
                else:
                    # Object format
                    tc_index = getattr(tc_chunk, "index", 0)
                    tc_id = getattr(tc_chunk, "id", "") or ""
                    tc_name = getattr(tc_chunk, "name", "") or ""
                    tc_args = getattr(tc_chunk, "args", "") or getattr(tc_chunk, "arguments", "") or ""

                logger.info(f"Tool call chunk parsed: index={tc_index}, id={tc_id}, name={tc_name}, args={tc_args}")

                # Find existing tool call by index (more reliable than id)
                existing = None
                if tc_index < len(tool_calls):
                    existing = tool_calls[tc_index]
                elif tc_id:
                    # Fall back to id matching if index doesn't work
                    for tc in tool_calls:
                        if tc["id"] == tc_id:
                            existing = tc
                            break

                if existing:
                    # Update existing entry
                    if tc_id and not existing["id"]:
                        existing["id"] = tc_id
                    if tc_name and not existing["name"]:
                        existing["name"] = tc_name
                    if tc_args:
                        existing["arguments"] += tc_args
                else:
                    # Create new entry
                    tool_calls.append({
                        "id": tc_id,
                        "name": tc_name,
                        "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args),
                    })

                if on_tool_call:
                    on_tool_call({
                        "id": tc_id,
                        "name": tc_name,
                        "arguments_delta": tc_args,
                    })

    # Parse tool call arguments
    for tc in tool_calls:
        logger.info(f"Processing tool call: name={tc.get('name')}, raw_args={tc.get('arguments')}")
        if isinstance(tc["arguments"], str):
            args_str = tc["arguments"]
            if args_str.strip():
                try:
                    tc["arguments"] = json.loads(args_str)
                    logger.info(f"Parsed tool call arguments: {tc['arguments']}")
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse tool call arguments: {args_str}, error: {e}")
                    # Keep as dict with error info instead of empty dict
                    tc["arguments"] = {"_parse_error": str(e), "_raw": args_str}
            else:
                logger.warning(f"Empty arguments for tool call: {tc.get('name')}")
                tc["arguments"] = {}

    result = {
        "content": content,
        "tool_calls": tool_calls,
        "finish_reason": "tool_calls" if tool_calls else "stop",
    }

    if on_finish:
        on_finish(result)

    return result
