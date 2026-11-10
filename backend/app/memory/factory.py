import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ArchitectureUnsupportedException
from app.memory.base import BaseMemory
from app.memory.history import HistoryMemory
from app.memory.hybrid import HybridMemory
from app.memory.structured import StructuredMemory
from app.memory.vector import VectorMemory


def get_memory_architecture(
    architecture_type: str,
    db: AsyncSession,
    namespace_id: uuid.UUID,
    config: dict[str, Any] | None = None
) -> BaseMemory:
    """
    Factory function to instantiate the requested memory architecture.
    Ensures the benchmark runner interacts exclusively through the BaseMemory contract.
    """
    arch = architecture_type.lower().strip()
    if arch == "history":
        return HistoryMemory(db=db, namespace_id=namespace_id, config=config)
    elif arch == "vector":
        return VectorMemory(db=db, namespace_id=namespace_id, config=config)
    elif arch == "structured":
        return StructuredMemory(db=db, namespace_id=namespace_id, config=config)
    elif arch == "hybrid":
        return HybridMemory(db=db, namespace_id=namespace_id, config=config)
    else:
        raise ArchitectureUnsupportedException(architecture=architecture_type)