"""Application configuration using pydantic-settings."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = "agent_wechat.db"

    # Redis (空字符串表示使用内存模式)
    redis_url: str = ""

    # LLM Provider
    llm_provider: Literal["glm", "openrouter", "qwen", "anthropic", "openai"] = "openai"

    # GLM (智谱 AI)
    glm_api_key: str = ""
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    glm_model: str = "glm-4.7"

    # Qwen (通义千问)
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-max"

    # OpenRouter
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "anthropic/claude-3.5-sonnet"
    openrouter_http_referer: str = ""
    openrouter_app_title: str = ""

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_model: str = "claude-3-5-sonnet-20241022"

    # OpenAI
    openai_api_key: str = "hApEHVmHSZm1-4NHWfPWfUy9boJ4ZngnqUlJJ3_AYErSyAMNKDAg6TSeLx7-_9NXiFzAT2LArA"
    openai_base_url: str = "https://router.shengsuanyun.com/api/v1"
    openai_model: str = "deepseek/deepseek-v3.2-think"

    # MCP
    mcp_config_path: str = "mcp.json"
    mcp_timeout_ms: int = 30000
    mcp_load_timeout_ms: int = 2000

    # Agent
    agent_workdir: str = ""


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()


class AppConfig:
    """Application configuration loaded from config/app.json."""

    def __init__(self):
        self.token_limit: int = 256000
        self._load()

    def _load(self):
        config_path = Path(__file__).parent.parent / "config" / "app.json"
        if config_path.exists():
            try:
                with open(config_path) as f:
                    data = json.load(f)
                    self.token_limit = data.get("tokenLimit", self.token_limit)
            except Exception:
                pass


_app_config: AppConfig | None = None


def get_app_config() -> AppConfig:
    """Get application configuration."""
    global _app_config
    if _app_config is None:
        _app_config = AppConfig()
    return _app_config
