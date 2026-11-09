import time
from typing import Optional
from app.llm.base import BaseLLMAdapter, LLMResponse


class MockLLMAdapter(BaseLLMAdapter):
    """
    Deterministic Mock LLM.
    Scans the prompt context for answers or returns a deterministic response.
    Ideal for unit tests, offline development, and zero-cost benchmark pipeline validation.
    """

    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 512,
        temperature: float = 0.0
    ) -> LLMResponse:
        start_time = time.perf_counter()

        # Simple heuristic to extract the most relevant fact from the prompt context
        text_output = "No information found."
        lines = prompt.splitlines()
        for line in lines:
            line_clean = line.strip()
            if line_clean.startswith("- ") or line_clean.startswith("* "):
                text_output = line_clean.lstrip("- *").strip()
                break

        latency = (time.perf_counter() - start_time) * 1000
        # Estimate approximate token count (roughly 4 chars per token)
        prompt_tokens = max(1, len(prompt) // 4)
        completion_tokens = max(1, len(text_output) // 4)

        return LLMResponse(
            text=text_output,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            latency_ms=round(latency, 2),
            model_name="mock-model",
            metadata={"mock": True}
        )