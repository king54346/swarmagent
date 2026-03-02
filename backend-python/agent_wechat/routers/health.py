"""
健康检查路由模块

提供服务存活探测端点，用于负载均衡器、Kubernetes 等检测服务状态
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    健康检查端点
    
    Returns:
        dict: 包含 ok=True 表示服务正常运行
    """
    return {"ok": True}
