import re
import time
from app.llm.base import BaseLLMAdapter, LLMResponse

_INDEXED_LINE_RE = re.compile(r"^\[\d+\]\s+(.+)$")
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "what", "which", "who", "when", "where", "why", "how",
    "is", "are", "was", "were", "do", "does", "did",
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "as", "by",
    "my", "our", "your", "their", "its", "this", "that",
    "list", "tell", "me", "give", "currently",
}


class MockLLMAdapter(BaseLLMAdapter):
    """
    Deterministic Mock LLM.
    Extracts relevant retrieved memories from ContextBuilder prompts ([1] ...) or bulleted prompts (- / *)
    without ground-truth access, enabling realistic offline benchmark pipeline verification.
    """

    @staticmethod
    def _extract_candidates_and_question(prompt: str) -> tuple[list[str], str]:
        candidates: list[str] = []
        question_lines: list[str] = []
        in_question = False

        for raw_line in prompt.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("Question:"):
                in_question = True
                q_part = line[len("Question:"):].strip()
                if q_part:
                    question_lines.append(q_part)
                continue

            if line.startswith("Answer:"):
                in_question = False
                continue

            if in_question:
                question_lines.append(line)
                continue

            idx_match = _INDEXED_LINE_RE.match(line)
            if idx_match:
                candidates.append(idx_match.group(1).strip())
            elif line.startswith("- ") or line.startswith("* "):
                candidates.append(line[2:].strip())

        return candidates, " ".join(question_lines).strip()

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> LLMResponse:
        start_time = time.perf_counter()

        candidates, question = self._extract_candidates_and_question(prompt)
        text_output = "No information found."

        if candidates:
            q_lower = question.lower()
            q_keywords = {
                tok for tok in _TOKEN_RE.findall(q_lower)
                if tok not in _STOP_WORDS and len(tok) > 1
            }

            if "list " in q_lower or " and " in q_lower:
                # Multi-hop synthesis: combine all retrieved lines relevant to the query
                matched = [
                    cand for cand in candidates
                    if not q_keywords or (q_keywords & set(_TOKEN_RE.findall(cand.lower())))
                ]
                selected = matched if matched else candidates
                text_output = " ".join(selected)
            elif q_keywords:
                # Select highest keyword-overlap candidate (ties keep top retrieval rank [1])
                best_cand = candidates[0]
                best_score = -1
                for cand in candidates:
                    overlap = len(q_keywords & set(_TOKEN_RE.findall(cand.lower())))
                    if overlap > best_score:
                        best_score = overlap
                        best_cand = cand
                text_output = best_cand
            else:
                text_output = candidates[0]

        latency = (time.perf_counter() - start_time) * 1000
        prompt_tokens = max(1, len(prompt) // 4)
        completion_tokens = max(1, len(text_output) // 4)

        return LLMResponse(
            text=text_output,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            latency_ms=round(latency, 2),
            model_name=self.model_name,
            metadata={"mock": True},
        )