import asyncio
import time

import httpx

from app.core.config import settings
from app.llm.base import BaseLLMAdapter, LLMResponse

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class OllamaLLMAdapter(BaseLLMAdapter):
    """Connects to local Ollama instance (http://localhost:11434) with transient retry handling."""

    def __init__(
        self,
        model_name: str | None = None,
        base_url: str | None = None,
        max_retries: int = 2,
    ):
        super().__init__(model_name=model_name or "llama3:latest")
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        self.max_retries = max_retries

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> LLMResponse:
        start_time = time.perf_counter()

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "system": system_prompt or "",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        last_exc: Exception | None = None
        data: dict = {}
        async with httpx.AsyncClient(timeout=120.0) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    response = await client.post(f"{self.base_url}/api/generate", json=payload)
                    if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    response.raise_for_status()
                    data = response.json()
                    break
                except (httpx.TimeoutException, httpx.ConnectError) as exc:
                    last_exc = exc
                    if attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    raise
            else:
                if last_exc:
                    raise last_exc

        latency = (time.perf_counter() - start_time) * 1000
        text_out = data.get("response", "")
        prompt_tokens = data.get("prompt_eval_count", len(prompt) // 4)
        completion_tokens = data.get("eval_count", len(text_out) // 4)

        return LLMResponse(
            text=text_out,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            latency_ms=round(latency, 2),
            model_name=self.model_name,
            metadata={"done": data.get("done", True)},
        )