import time
from typing import Optional
import httpx
from app.core.config import settings
from app.llm.base import BaseLLMAdapter, LLMResponse


class OllamaLLMAdapter(BaseLLMAdapter):
    """Connects to local Ollama instance (http://localhost:11434)."""

    def __init__(self, model_name: Optional[str] = None, base_url: Optional[str] = None):
        super().__init__(model_name=model_name or "llama3:latest")
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")

    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 512,
        temperature: float = 0.0
    ) -> LLMResponse:
        start_time = time.perf_counter()

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "system": system_prompt or "",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{self.base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()

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
            metadata={"done": data.get("done", True)}
        )