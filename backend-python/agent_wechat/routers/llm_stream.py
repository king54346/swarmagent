"""
LLM 流式路由模块

提供大语言模型（LLM）的流式响应接口
支持 SSE（Server-Sent Events）实时推送生成内容
"""

import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..ai.llm_client import stream_llm
from ..ai.providers import get_model_info

router = APIRouter()


class LLMStreamRequest(BaseModel):
    """
    LLM 流式请求体
    
    Attributes:
        provider: LLM 提供商，如 'openai', 'anthropic' 等
        model: 模型名称，如 'gpt-4', 'claude-3' 等
        messages: 对话消息列表，包含 role 和 content
        tools: 可用工具列表，用于 Function Calling
        thinking: 是否启用思维链模式
        maxTokens: 最大生成 token 数
        temperature: 生成温度，控制随机性
        system: 系统提示词
    """
    provider: Optional[str] = None
    model: Optional[str] = None
    messages: list[dict]
    tools: Optional[list] = None
    thinking: Optional[bool] = False
    maxTokens: Optional[int] = None
    temperature: Optional[float] = None
    system: Optional[str] = None


def sse_event(event: str, data: dict) -> str:
    """
    格式化 SSE 事件
    
    Args:
        event: 事件类型，如 'start', 'content', 'done' 等
        data: 事件数据
    
    Returns:
        str: 符合 SSE 规范的格式化字符串
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/llm/stream")
async def llm_stream(body: LLMStreamRequest):
    """
    LLM 流式响应接口
    
    通过 SSE 实时推送 LLM 生成的内容，支持以下事件类型：
    - start: 开始生成，返回 provider 和 model 信息
    - content: 内容增量，返回生成的文本片段
    - tool_call: 工具调用，返回 Function Calling 信息
    - done: 生成完成，返回完整内容和结束原因
    - error: 错误信息
    
    Args:
        body: LLM 请求参数
    
    Returns:
        StreamingResponse: SSE 流式响应
    """

    async def event_generator():
        # 获取模型信息
        model_info = get_model_info(body.provider)

        # 发送开始事件
        yield sse_event("start", {
            "provider": model_info["provider"],
            "model": model_info["model"],
        })

        # 准备消息列表
        messages = list(body.messages)

        # 如果提供了系统提示词，插入到消息开头
        if body.system:
            messages.insert(0, {"role": "system", "content": body.system})

        # 累积生成的内容
        content_parts = []
        # 工具调用原始数据
        tool_calls_raw: list[dict] = []

        def on_content(delta: str):
            """内容增量回调"""
            content_parts.append(delta)

        def on_tool_call(tc: dict):
            """工具调用回调，累积工具调用参数"""
            tc_id = tc.get("id", "")
            tc_name = tc.get("name", "")
            tc_args_delta = tc.get("arguments_delta", "")

            # 查找或创建工具调用条目
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

        try:
            # 调用 LLM 进行流式生成
            result = await stream_llm(
                messages=messages,
                tools=body.tools,
                provider=body.provider,
                model_name=body.model,
                on_content=on_content,
                on_tool_call=on_tool_call,
            )

            # 发送内容块
            content = result.get("content", "")
            if content:
                # 分块发送以提高响应性
                chunk_size = 10
                for i in range(0, len(content), chunk_size):
                    chunk = content[i:i + chunk_size]
                    yield sse_event("content", {"delta": chunk})

            # 发送工具调用事件（如果有）
            tool_calls = result.get("tool_calls", [])
            for tc in tool_calls:
                yield sse_event("tool_call", {
                    "id": tc.get("id", ""),
                    "name": tc.get("name", ""),
                    "arguments": tc.get("arguments", {}),
                })

            # 发送完成事件
            yield sse_event("done", {
                "content": content,
                "finishReason": result.get("finish_reason", "stop"),
                "toolCalls": tool_calls,
            })

        except Exception as e:
            yield sse_event("error", {"message": str(e)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Encoding": "none",
        },
    )


@router.get("/llm/info")
async def llm_info(provider: Optional[str] = None):
    """
    获取 LLM 提供商和模型信息
    
    Args:
        provider: 提供商名称，可选，不指定则返回默认提供商信息
    
    Returns:
        dict: 包含 provider 和 model 信息的响应
    """
    return get_model_info(provider)
