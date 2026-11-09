import time
from typing import Optional
import httpx
from app.core.config import settings
from app.llm.base import BaseLLMAdapter, LLMResponse


class OpenAICompatibleLLMAdapter(BaseLLMAdapter):
    """Connects to any OpenAI-compatible /v1/chat/completions endpoint."""

    def __init__(self, model_name: Optional[str] = None, api_key: Optional[str] = None, base_url: Optional[str] = None):
        super().__init__(model_name=model_name or settings.DEFAULT_LLM_MODEL)
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.base_url = (base_url or settings.OPENAI_BASE_URL).rstrip("/")

    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 512,
        temperature: float = 0.0
    ) -> LLMResponse:
        start_time = time.perf_counter()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            data = response.json()

        latency = (time.perf_counter() - start_time) * 1000
        choice = data["choices"][0]
        text_out = choice["message"]["content"]
        usage = data.get("usage", {})

        return LLMResponse(
            text=text_out,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            latency_ms=round(latency, 2),
            model_name=self.model_name,
            metadata={"finish_reason": choice.get("finish_reason")}
        )