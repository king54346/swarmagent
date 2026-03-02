"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import (
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    from .db.init_db import ensure_schema
    from .runtime.agent_runtime import get_agent_runtime

    ensure_schema()

    # Bootstrap agent runtime
    runtime = get_agent_runtime()
    await runtime.bootstrap()

    yield
    # Shutdown
    pass


app = FastAPI(
    title="Agent WeChat API",
    description="Python FastAPI backend for Agent WeChat with LangGraph",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
# 健康检查路由 - 提供 /health 端点用于服务存活探测
app.include_router(health.router, prefix="/api", tags=["health"])
# 工作空间路由 - 管理工作空间的创建、列表、删除及默认配置
app.include_router(workspaces.router, prefix="/api", tags=["workspaces"])
# Agent 路由 - 管理 AI 代理的 CRUD 操作（创建、查询、删除）
app.include_router(agents.router, prefix="/api", tags=["agents"])
# 群组路由 - 管理聊天群组的创建、列表、删除（支持 P2P 和多人群）
app.include_router(groups.router, prefix="/api", tags=["groups"])
# 消息路由 - 处理群组内消息的发送和查询，触发 Agent 唤醒
app.include_router(messages.router, prefix="/api", tags=["messages"])
# 管理员路由 - 提供数据库初始化、清空、重置等管理操作
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
# 搜索路由 - 提供工作空间内 Agent 和群组的搜索功能
app.include_router(search.router, prefix="/api", tags=["search"])
# 配置路由 - 获取应用配置信息（如 token 限制等）
app.include_router(config_routes.router, prefix="/api", tags=["config"])
# Agent 图谱路由 - 获取 Agent 间的通信关系图（节点和边）
app.include_router(agent_graph.router, prefix="/api", tags=["agent-graph"])
# LLM 流式路由 - 提供大模型流式响应接口，支持 SSE 推送
app.include_router(llm_stream.router, prefix="/api", tags=["llm"])
# SSE 路由 - 提供实时事件推送（Agent 上下文流、UI 事件流）
app.include_router(sse.router, prefix="/api", tags=["sse"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
