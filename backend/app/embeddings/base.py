from abc import ABC, abstractmethod


class BaseEmbeddingService(ABC):
    """Abstract interface for generating vector embeddings."""

    @abstractmethod
    def embed_text(self, text: str) -> list[float]:
        """Synchronously generate an embedding vector for a single string."""

    @abstractmethod
    async def aembed_text(self, text: str) -> list[float]:
        """Asynchronously generate an embedding vector for a single string."""

    @abstractmethod
    async def aembed_batch(self, texts: list[str]) -> list[list[float]]:
        """Asynchronously generate embedding vectors for a batch of strings."""

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Return the vector dimension (e.g. 384 for all-MiniLM-L6-v2)."""
