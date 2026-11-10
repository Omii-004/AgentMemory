import asyncio
import time
import httpx
from app.core.config import settings
from app.llm.base import BaseLLMAdapter, LLMResponse

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class OpenAICompatibleLLMAdapter(BaseLLMAdapter):
    """Connects to any OpenAI-compatible /v1/chat/completions endpoint with retry handling."""

    def __init__(
        self,
        model_name: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        max_retries: int = 2,
    ):
        super().__init__(model_name=model_name or settings.DEFAULT_LLM_MODEL)
        self.api_key = (api_key if api_key is not None else settings.OPENAI_API_KEY).strip()
        self.base_url = (base_url or settings.OPENAI_BASE_URL).rstrip("/")
        self.max_retries = max_retries

        is_local = "localhost" in self.base_url or "127.0.0.1" in self.base_url
        if not self.api_key and not is_local:
            raise ValueError("OPENAI_API_KEY is required when using a remote OpenAI-compatible provider.")

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> LLMResponse:
        start_time = time.perf_counter()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        last_exc: Exception | None = None
        data: dict = {}
        async with httpx.AsyncClient(timeout=60.0) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
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
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI-compatible response contained no choices.")
        choice = choices[0]
        text_out = choice["message"]["content"]
        usage = data.get("usage", {})

        return LLMResponse(
            text=text_out,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            latency_ms=round(latency, 2),
            model_name=self.model_name,
            metadata={"finish_reason": choice.get("finish_reason")},
        )