from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class LLMResponse(BaseModel):
    """Standardized response from any LLM provider."""
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: float = 0.0
    model_name: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BaseLLMAdapter(ABC):
    """Abstract Base Class for LLM providers."""

    def __init__(self, model_name: str, **kwargs):
        self.model_name = model_name
        self.extra_config = kwargs

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 512,
        temperature: float = 0.0
    ) -> LLMResponse:
        """Asynchronously generates text from the model."""
        pass