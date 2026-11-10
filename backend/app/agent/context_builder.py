from app.memory.schemas import RetrievedMemory


class ContextBuilder:
    """
    Constructs the prompt sent to the LLM by assembling retrieved long-term memories
    and the target question/query.
    """

    DEFAULT_SYSTEM_PROMPT = (
        "You are an AI assistant equipped with a long-term memory system. "
        "Use the retrieved memories below to answer the user's question accurately. "
        "If conflicting or updated information exists, prioritize the latest valid information. "
        "Keep your answer concise and direct."
    )

    @classmethod
    def build_prompt(cls, query: str, memories: list[RetrievedMemory]) -> str:
        """Formats retrieved memories into structured prompt context."""
        if not memories:
            return f"Question: {query}\nAnswer:"

        formatted_memories = []
        for idx, mem in enumerate(memories, start=1):
            formatted_memories.append(f"[{idx}] {mem.content}")

        memory_block = "\n".join(formatted_memories)
        prompt = (
            f"Relevant Context from Long-Term Memory:\n"
            f"{memory_block}\n\n"
            f"Question: {query}\n"
            f"Answer:"
        )
        return prompt