import asyncio
from typing import Optional

from sentence_transformers import SentenceTransformer

from app.core.config import settings
from app.core.logging import get_logger
from app.embeddings.base import BaseEmbeddingService

logger = get_logger(__name__)


class SentenceTransformerEmbeddingService(BaseEmbeddingService):
    """Local, CPU-optimized SentenceTransformer embedding engine."""

    _instance: Optional["SentenceTransformerEmbeddingService"] = None
    _model: SentenceTransformer | None = None

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or settings.EMBEDDING_MODEL
        self._dimension = settings.EMBEDDING_DIMENSION
        if SentenceTransformerEmbeddingService._model is None:
            logger.info(f"Loading embedding model '{self.model_name}' on CPU...")
            SentenceTransformerEmbeddingService._model = SentenceTransformer(
                self.model_name, device="cpu"
            )
            logger.info(f"Embedding model loaded. Dimension: {self._dimension}")

    @property
    def model(self) -> SentenceTransformer:
        if SentenceTransformerEmbeddingService._model is None:
            SentenceTransformerEmbeddingService._model = SentenceTransformer(
                self.model_name, device="cpu"
            )
        return SentenceTransformerEmbeddingService._model

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed_text(self, text: str) -> list[float]:
        """Generates embedding synchronously on CPU."""
        embedding = self.model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
        return embedding.tolist()

    async def aembed_text(self, text: str) -> list[float]:
        """Offloads CPU encoding to thread pool to prevent blocking FastAPI's async event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed_text, text)

    async def aembed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding offloaded to thread pool."""
        loop = asyncio.get_running_loop()
        def _batch_encode():
            embeddings = self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
            return embeddings.tolist()
        return await loop.run_in_executor(None, _batch_encode)


# Singleton factory for global reuse
_global_embedding_service: SentenceTransformerEmbeddingService | None = None

def get_embedding_service() -> SentenceTransformerEmbeddingService:
    global _global_embedding_service
    if _global_embedding_service is None:
        _global_embedding_service = SentenceTransformerEmbeddingService()
    return _global_embedding_service