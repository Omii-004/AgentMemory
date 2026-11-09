from abc import ABC, abstractmethod
from typing import List


class BaseEmbeddingService(ABC):
    """Abstract interface for generating vector embeddings."""

    @abstractmethod
    def embed_text(self, text: str) -> List[float]:
        """Synchronously generate an embedding vector for a single string."""
        pass

    @abstractmethod
    async def aembed_text(self, text: str) -> List[float]:
        """Asynchronously generate an embedding vector for a single string."""
        pass

    @abstractmethod
    async def aembed_batch(self, texts: List[str]) -> List[List[float]]:
        """Asynchronously generate embedding vectors for a batch of strings."""
        pass

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Return the vector dimension (e.g. 384 for all-MiniLM-L6-v2)."""
        pass