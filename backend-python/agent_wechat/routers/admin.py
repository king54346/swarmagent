"""
管理员路由模块

提供数据库初始化、清空、重置等管理操作
仅供管理员或开发调试使用
"""

from fastapi import APIRouter, HTTPException

from ..db.init_db import ensure_schema
from ..db.engine import get_engine
from ..db.models import Base

router = APIRouter()


@router.post("/init-db")
async def init_db():
    """
    初始化数据库 Schema
    
    创建所有必需的数据库表，如果表已存在则跳过
    
    Returns:
        dict: 包含 ok=True 表示初始化成功
    
    Raises:
        HTTPException 500: 初始化失败
    """
    try:
        ensure_schema()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "ok": False,
                "error": "Failed to init schema",
                "message": str(e),
            },
        )


@router.post("/clear-db")
async def clear_db():
    """
    清空数据库中的所有数据
    
    按照外键约束顺序删除所有表中的数据，保留表结构
    
    Returns:
        dict: 包含 ok=True 表示清空成功
    """
    from sqlalchemy import text
    engine = get_engine()

    with engine.connect() as conn:
        # Delete in order to respect foreign keys
        for table in ["messages", "group_members", "groups", "agents", "workspaces"]:
            try:
                conn.execute(text(f"DELETE FROM {table}"))
            except Exception:
                pass
        conn.commit()

    return {"ok": True}


@router.post("/reset")
async def reset_db():
    """
    重置数据库
    
    清空所有数据并重新初始化 Schema，相当于全新启动
    
    Returns:
        dict: 包含 ok=True 表示重置成功
    """
    from sqlalchemy import text
    engine = get_engine()

    with engine.connect() as conn:
        # Delete in order to respect foreign keys
        for table in ["messages", "group_members", "groups", "agents", "workspaces"]:
            try:
                conn.execute(text(f"DELETE FROM {table}"))
            except Exception:
                pass
        conn.commit()

    # TODO: Clear Redis (Phase 4)

    ensure_schema()

    return {"ok": True}


@router.post("/clear-realtime")
async def clear_realtime():
    """
    清空实时数据（Redis）
    
    清除 Redis 中的实时状态数据，如 Agent 在线状态等
    
    Returns:
        dict: 包含 ok=True 和 deleted 计数的响应
    
    Note:
        待实现 Redis 模块后完善
    """
    # TODO: Implement when Redis module is ready (Phase 4)
    return {"ok": True, "deleted": 0}
