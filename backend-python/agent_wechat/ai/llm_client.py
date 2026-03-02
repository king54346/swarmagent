"""LLM streaming client using LangChain."""

import json
from typing import Any, Callable, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from .providers import create_model, get_llm_provider


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
        # Handle content
        if hasattr(chunk, "content") and chunk.content:
            delta = chunk.content
            content += delta
            if on_content:
                on_content(delta)

        # Handle tool calls
        if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
            for tc_chunk in chunk.tool_call_chunks:
                # Find or create tool call entry
                tc_id = tc_chunk.get("id") or ""
                tc_name = tc_chunk.get("name") or ""
                tc_args = tc_chunk.get("args") or ""

                # Find existing tool call
                existing = None
                for tc in tool_calls:
                    if tc["id"] == tc_id:
                        existing = tc
                        break

                if existing:
                    if tc_args:
                        existing["arguments"] += tc_args
                else:
                    tool_calls.append({
                        "id": tc_id,
                        "name": tc_name,
                        "arguments": tc_args,
                    })

                if on_tool_call:
                    on_tool_call({
                        "id": tc_id,
                        "name": tc_name,
                        "arguments_delta": tc_args,
                    })

    # Parse tool call arguments
    for tc in tool_calls:
        if isinstance(tc["arguments"], str):
            try:
                tc["arguments"] = json.loads(tc["arguments"])
            except json.JSONDecodeError:
                tc["arguments"] = {}

    result = {
        "content": content,
        "tool_calls": tool_calls,
        "finish_reason": "tool_calls" if tool_calls else "stop",
    }

    if on_finish:
        on_finish(result)

    return result
