import asyncio
import logging
import time
from typing import Any

import httpx

from app.core.config import Settings
from app.llm.base import BaseLLMAdapter, LLMResponse

logger = logging.getLogger(__name__)

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
        fresh_settings = Settings()
        super().__init__(model_name=model_name or fresh_settings.DEFAULT_LLM_MODEL)
        self.api_key = (api_key if api_key is not None else fresh_settings.OPENAI_API_KEY).strip()
        self.base_url = (base_url or fresh_settings.OPENAI_BASE_URL).rstrip("/")
        self.max_retries = max_retries

        is_local = "localhost" in self.base_url or "127.0.0.1" in self.base_url
        if not self.api_key and not is_local:
            raise ValueError("OPENAI_API_KEY is required when using a remote OpenAI-compatible provider.")

        logger.info(
            "Initialized OpenAICompatibleLLMAdapter [endpoint: %s/chat/completions, model: %s]",
            self.base_url,
            self.model_name,
        )

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

        headers = {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://agentmemory.ai",
            "X-Title": "AgentMemory Benchmark",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        last_exc: Exception | None = None
        data: dict[str, Any] = {}
        endpoint = f"{self.base_url}/chat/completions"
        logger.info("Connecting to LLM endpoint: %s (model: %s)", endpoint, self.model_name)

        async with httpx.AsyncClient(timeout=60.0) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    response = await client.post(
                        endpoint,
                        headers=headers,
                        json=payload,
                    )
                    if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                        logger.warning(
                            "Retryable HTTP %s from %s, retrying attempt %d...",
                            response.status_code,
                            endpoint,
                            attempt + 1,
                        )
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    response.raise_for_status()
                    data = response.json()
                    break
                except httpx.HTTPError as exc:
                    last_exc = exc
                    logger.warning("HTTP error on %s attempt %d: %s", endpoint, attempt + 1, exc)
                    if attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (attempt + 1))
                    else:
                        raise

        latency_ms = (time.perf_counter() - start_time) * 1000.0

        choices = data.get("choices", [])
        if not choices:
            raise ValueError(f"Empty choices in OpenAI response: {data}")

        choices = data.get("choices") or []
        if not choices:
            raise ValueError(f"Empty choices in OpenAI response: {data}")
        choice = choices[0]
        msg = choice.get("message") or {}
        raw_text = msg.get("content")
        if raw_text is None:
            # Fall back to reasoning_content, refusal, or choice text if content is None
            raw_text = msg.get("reasoning_content") or msg.get("refusal") or choice.get("text") or ""
        text = str(raw_text).strip()
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens") or 0
        completion_tokens = usage.get("completion_tokens") or 0
        total_tokens = usage.get("total_tokens") or (prompt_tokens + completion_tokens)
        return LLMResponse(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=round(latency_ms, 2),
            model_name=self.model_name,
            metadata=data,
        )