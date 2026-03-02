"""
配置路由模块

提供应用配置信息的获取接口
如 token 限制、模型配置等
"""

from fastapi import APIRouter

from ..config import get_app_config

router = APIRouter()


@router.get("/config")
async def get_config():
    """
    获取应用配置
    
    返回前端需要的配置信息，如 token 数量限制等
    
    Returns:
        dict: 包含 tokenLimit 等配置项的响应
    """
    config = get_app_config()
    return {"tokenLimit": config.token_limit}
