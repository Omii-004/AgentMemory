import time
import uuid
from abc import ABC, abstractmethod
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.memory.schemas import MemoryItem, MemoryOperationResult, RetrievedMemory

logger = get_logger(__name__)


class BaseMemory(ABC):
    """
    Abstract Base Class that every memory architecture MUST implement.
    Guarantees strict isolation by operating exclusively within a designated namespace_id.
    """

    def __init__(self, db: AsyncSession, namespace_id: uuid.UUID, config: dict[str, Any] | None = None):
        self.db = db
        self.namespace_id = namespace_id
        self.config = config or {}

    @property
    @abstractmethod
    def architecture_type(self) -> str:
        """Returns the architecture identifier (history, vector, structured, hybrid)."""
        pass

    @abstractmethod
    async def _store_internal(self, item: MemoryItem) -> list[str]:
        """Architecture-specific write implementation."""
        pass

    @abstractmethod
    async def _retrieve_internal(self, query: str, top_k: int = 5) -> list[RetrievedMemory]:
        """Architecture-specific retrieval implementation."""
        pass

    @abstractmethod
    async def _update_internal(self, memory_id: str, new_item: MemoryItem) -> bool:
        """Architecture-specific update implementation."""
        pass

    @abstractmethod
    async def _delete_internal(self, memory_id: str) -> bool:
        """Architecture-specific deletion implementation."""
        pass

    @abstractmethod
    async def _clear_internal(self) -> bool:
        """Removes all memories within this namespace."""
        pass

    async def _safe_rollback(self) -> None:
        try:
            await self.db.rollback()
        except Exception as rollback_err:
            logger.error("Failed to rollback session after memory operation error: %s", rollback_err)

    # Public Traceable API Wrappers
    async def store(self, item: MemoryItem) -> MemoryOperationResult:
        start_time = time.perf_counter()
        try:
            stored_ids = await self._store_internal(item)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="store",
                architecture=self.architecture_type,
                status="success",
                latency_ms=round(latency, 2),
                affected_memory_ids=stored_ids,
                metadata={"item_type": item.memory_type},
            )
        except Exception as e:
            await self._safe_rollback()
            logger.exception("[%s] store failed in namespace %s: %s", self.architecture_type, self.namespace_id, e)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="store",
                architecture=self.architecture_type,
                status="error",
                latency_ms=round(latency, 2),
                error_message=str(e),
            )

    async def retrieve(self, query: str, top_k: int = 5) -> MemoryOperationResult:
        start_time = time.perf_counter()
        try:
            retrieved = await self._retrieve_internal(query=query, top_k=top_k)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="retrieve",
                architecture=self.architecture_type,
                status="success",
                latency_ms=round(latency, 2),
                retrieved_memories=retrieved,
                retrieved_memory_ids=[str(m.id) for m in retrieved],
                metadata={"query": query, "top_k": top_k},
            )
        except Exception as e:
            await self._safe_rollback()
            logger.exception("[%s] retrieve failed in namespace %s: %s", self.architecture_type, self.namespace_id, e)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="retrieve",
                architecture=self.architecture_type,
                status="error",
                latency_ms=round(latency, 2),
                error_message=str(e),
            )

    async def update(self, memory_id: str, new_item: MemoryItem) -> MemoryOperationResult:
        start_time = time.perf_counter()
        try:
            success = await self._update_internal(memory_id=memory_id, new_item=new_item)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="update",
                architecture=self.architecture_type,
                status="success" if success else "failure",
                latency_ms=round(latency, 2),
                affected_memory_ids=[memory_id] if success else [],
            )
        except Exception as e:
            await self._safe_rollback()
            logger.exception("[%s] update failed for memory %s: %s", self.architecture_type, memory_id, e)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="update",
                architecture=self.architecture_type,
                status="error",
                latency_ms=round(latency, 2),
                error_message=str(e),
            )

    async def delete(self, memory_id: str) -> MemoryOperationResult:
        start_time = time.perf_counter()
        try:
            success = await self._delete_internal(memory_id=memory_id)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="delete",
                architecture=self.architecture_type,
                status="success" if success else "failure",
                latency_ms=round(latency, 2),
                affected_memory_ids=[memory_id] if success else [],
            )
        except Exception as e:
            await self._safe_rollback()
            logger.exception("[%s] delete failed for memory %s: %s", self.architecture_type, memory_id, e)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="delete",
                architecture=self.architecture_type,
                status="error",
                latency_ms=round(latency, 2),
                error_message=str(e),
            )

    async def clear(self) -> MemoryOperationResult:
        start_time = time.perf_counter()
        try:
            success = await self._clear_internal()
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="clear",
                architecture=self.architecture_type,
                status="success" if success else "failure",
                latency_ms=round(latency, 2),
            )
        except Exception as e:
            await self._safe_rollback()
            logger.exception("[%s] clear failed in namespace %s: %s", self.architecture_type, self.namespace_id, e)
            latency = (time.perf_counter() - start_time) * 1000
            return MemoryOperationResult(
                operation="clear",
                architecture=self.architecture_type,
                status="error",
                latency_ms=round(latency, 2),
                error_message=str(e),
            )