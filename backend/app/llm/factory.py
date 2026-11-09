from typing import Optional
from app.core.config import settings
from app.llm.base import BaseLLMAdapter
from app.llm.mock import MockLLMAdapter
from app.llm.ollama import OllamaLLMAdapter
from app.llm.openai_compatible import OpenAICompatibleLLMAdapter


def get_llm_adapter(
    provider: Optional[str] = None,
    model_name: Optional[str] = None,
    **kwargs
) -> BaseLLMAdapter:
    """Factory creating the configured LLM adapter."""
    prov = (provider or settings.LLM_PROVIDER).lower().strip()
    if prov == "mock":
        return MockLLMAdapter(model_name=model_name or "mock-model")
    elif prov == "ollama":
        return OllamaLLMAdapter(model_name=model_name)
    elif prov in ("openai", "openai_compatible", "openai-compatible"):
        return OpenAICompatibleLLMAdapter(model_name=model_name)
    else:
        # Fallback to mock with warning
        return MockLLMAdapter(model_name=model_name or "mock-model")