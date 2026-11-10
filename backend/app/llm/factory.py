from app.core.config import settings
from app.llm.base import BaseLLMAdapter
from app.llm.mock import MockLLMAdapter
from app.llm.ollama import OllamaLLMAdapter
from app.llm.openai_compatible import OpenAICompatibleLLMAdapter


def get_llm_adapter(
    provider: str | None = None,
    model_name: str | None = None,
    **kwargs,
) -> BaseLLMAdapter:
    """Factory creating the configured LLM adapter."""
    prov = (provider or settings.LLM_PROVIDER).lower().strip()
    if prov == "mock":
        return MockLLMAdapter(model_name=model_name or "mock-model")
    if prov == "ollama":
        return OllamaLLMAdapter(model_name=model_name)
    if prov in ("openai", "openai_compatible", "openai-compatible"):
        return OpenAICompatibleLLMAdapter(model_name=model_name)
    raise ValueError(
        f"Unsupported LLM provider '{prov}'. Supported providers: mock, ollama, openai, openai_compatible."
    )