"""LLM Provider factories using LangChain."""

from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_deepseek import ChatDeepSeek
from langchain_qwq import ChatQwen

from ..config import get_settings


def get_llm_provider() -> str:
    """Get the configured LLM provider."""
    return get_settings().llm_provider


def create_glm_model(model_override: Optional[str] = None) -> BaseChatModel:
    """Create a GLM (智谱) chat model."""
    from langchain_openai import ChatOpenAI

    settings = get_settings()
    return ChatOpenAI(
        api_key=settings.glm_api_key,
        base_url=settings.glm_base_url,
        model=model_override or settings.glm_model,
    )

# reasoning_contentOpenAI 或 Azure OpenAI Chat Completions API 均不返回此信息。OpenAI 的 Chat Completions API不支持推理输出。OpenAI 的 Responses API 提供推理摘要，ChatOpenAI 支持此功能（请参阅此处的文档）。
def create_qwen_model(model_override: Optional[str] = None) -> BaseChatModel:
    """Create a Qwen (通义千问) chat model."""
    from langchain_openai import ChatOpenAI

    settings = get_settings()
    # Remove trailing /chat/completions if present
    base_url = settings.qwen_base_url
    if base_url.endswith("/chat/completions"):
        base_url = base_url[:-18]

    return ChatQwen(
        api_key=settings.qwen_api_key,
        base_url=base_url,
        model=model_override or settings.qwen_model,
        extra_body={"enable_thinking": True},
    )


def create_openrouter_model(model_override: Optional[str] = None) -> BaseChatModel:
    """Create an OpenRouter chat model."""
    from langchain_openai import ChatOpenAI

    settings = get_settings()
    # Remove trailing /chat/completions if present
    base_url = settings.openrouter_base_url
    if base_url.endswith("/chat/completions"):
        base_url = base_url[:-18]

    headers = {}
    if settings.openrouter_http_referer:
        headers["HTTP-Referer"] = settings.openrouter_http_referer
    if settings.openrouter_app_title:
        headers["X-Title"] = settings.openrouter_app_title

    return ChatOpenAI(
        api_key=settings.openrouter_api_key,
        base_url=base_url,
        model=model_override or settings.openrouter_model,
        default_headers=headers if headers else None,
    )


def create_anthropic_model(model_override: Optional[str] = None) -> BaseChatModel:
    """Create an Anthropic Claude chat model."""
    from langchain_anthropic import ChatAnthropic

    settings = get_settings()
    return ChatAnthropic(
        api_key=settings.anthropic_api_key,
        base_url=settings.anthropic_base_url if settings.anthropic_base_url != "https://api.anthropic.com" else None,
        model=model_override or settings.anthropic_model,
    )


def create_openai_model(model_override: Optional[str] = None) -> BaseChatModel:
    """Create an OpenAI chat model."""
    from langchain_openai import ChatOpenAI

    settings = get_settings()
    return ChatOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url if settings.openai_base_url != "https://api.openai.com/v1" else None,
        model=model_override or settings.openai_model,
    )


def create_model(
    provider: Optional[str] = None,
    model_override: Optional[str] = None,
) -> BaseChatModel:
    """Create a chat model based on provider."""
    p = (provider or get_llm_provider()).lower()

    if p in ("openrouter", "open-router", "or"):
        return create_openrouter_model(model_override)
    elif p in ("qwen", "tongyi", "dashscope"):
        return create_qwen_model(model_override)
    elif p in ("anthropic", "claude"):
        return create_anthropic_model(model_override)
    elif p in ("openai", "gpt"):
        return create_openai_model(model_override)
    else:  # default to glm
        return create_glm_model(model_override)


def get_model_info(provider: Optional[str] = None) -> dict:
    """Get model configuration info."""
    settings = get_settings()
    p = (provider or get_llm_provider()).lower()

    if p in ("openrouter", "open-router", "or"):
        return {"provider": "openrouter", "model": settings.openrouter_model}
    elif p in ("qwen", "tongyi", "dashscope"):
        return {"provider": "qwen", "model": settings.qwen_model}
    elif p in ("anthropic", "claude"):
        return {"provider": "anthropic", "model": settings.anthropic_model}
    elif p in ("openai", "gpt"):
        return {"provider": "openai", "model": settings.openai_model}
    else:
        return {"provider": "glm", "model": settings.glm_model}
