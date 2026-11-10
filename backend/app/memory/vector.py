import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import Memory, MemoryEmbedding, MemoryEvent, MemoryVersion
from app.embeddings.service import get_embedding_service
from app.memory.base import BaseMemory
from app.memory.lifecycle import purge_memory_record, purge_namespace_memories
from app.memory.schemas import MemoryItem, RetrievedMemory


class VectorMemory(BaseMemory):
    """
    Vector-Based Memory Architecture.
    Transforms memories into 384-dimensional dense vectors using SentenceTransformers,
    indexes them in PostgreSQL using pgvector, and retrieves top-k by cosine similarity.
    """

    def __init__(self, db: AsyncSession, namespace_id: uuid.UUID, config: dict[str, Any] | None = None):
        super().__init__(db, namespace_id, config)
        self.embedding_service = get_embedding_service()
        self.similarity_threshold: float = float(self.config.get("similarity_threshold", 0.0))

    @property
    def architecture_type(self) -> str:
        return "vector"

    async def _store_internal(self, item: MemoryItem) -> list[str]:
        memory_id = uuid.uuid4()
        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type=item.memory_type or "semantic",
            content=item.content,
            importance=Decimal(str(item.importance)) if item.importance is not None else None,
            confidence=Decimal(str(item.confidence)) if item.confidence is not None else None,
            status="active",
        )
        self.db.add(memory)

        embedding_vector = await self.embedding_service.aembed_text(item.content)
        memory_embedding = MemoryEmbedding(
            memory_id=memory_id,
            embedding=embedding_vector,
            model_name=self.embedding_service.model_name,
            dimension=self.embedding_service.dimension,
        )
        self.db.add(memory_embedding)

        self.db.add(
            MemoryEvent(
                memory_id=memory_id,
                event_type="created",
                details={
                    "architecture": self.architecture_type,
                    "model": self.embedding_service.model_name,
                    "dimension": self.embedding_service.dimension,
                },
            )
        )
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> list[RetrievedMemory]:
        query_vector = await self.embedding_service.aembed_text(query)
        distance_expr = MemoryEmbedding.embedding.cosine_distance(query_vector).label("distance")

        stmt = (
            select(Memory, distance_expr)
            .join(MemoryEmbedding, Memory.id == MemoryEmbedding.memory_id)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status == "active",
            )
            .order_by(distance_expr.asc())
            .limit(top_k)
        )

        res = await self.db.execute(stmt)
        rows = res.all()

        retrieved: list[RetrievedMemory] = []
        for memory, distance in rows:
            similarity = max(0.0, 1.0 - float(distance))
            if similarity < self.similarity_threshold:
                continue

            retrieved.append(
                RetrievedMemory(
                    id=memory.id,
                    content=memory.content,
                    memory_type=memory.memory_type,
                    score=round(similarity, 4),
                    similarity=round(similarity, 4),
                    importance=float(memory.importance) if memory.importance is not None else None,
                    confidence=float(memory.confidence) if memory.confidence is not None else None,
                    source_message_id=memory.source_message_id,
                    created_at=memory.created_at,
                    metadata={"cosine_distance": float(distance)},
                )
            )
        return retrieved

    async def _update_internal(self, memory_id: str, new_item: MemoryItem) -> bool:
        target_uuid = uuid.UUID(memory_id)
        stmt = select(Memory).where(
            Memory.id == target_uuid,
            Memory.namespace_id == self.namespace_id,
            Memory.status == "active",
        )
        res = await self.db.execute(stmt)
        memory = res.scalars().first()
        if not memory:
            return False

        max_ver_res = await self.db.execute(
            select(func.coalesce(func.max(MemoryVersion.version_number), 0)).where(
                MemoryVersion.memory_id == target_uuid
            )
        )
        version_num = int(max_ver_res.scalar() or 0) + 1

        self.db.add(
            MemoryVersion(
                memory_id=target_uuid,
                version_number=version_num,
                previous_content=memory.content,
                new_content=new_item.content,
                change_reason=new_item.metadata.get("change_reason", "update"),
                changed_by="system",
            )
        )

        memory.content = new_item.content
        if new_item.importance is not None:
            memory.importance = Decimal(str(new_item.importance))
        if new_item.confidence is not None:
            memory.confidence = Decimal(str(new_item.confidence))

        new_vector = await self.embedding_service.aembed_text(new_item.content)
        emb_stmt = select(MemoryEmbedding).where(MemoryEmbedding.memory_id == target_uuid)
        emb_res = await self.db.execute(emb_stmt)
        embedding_row = emb_res.scalars().first()
        if embedding_row:
            embedding_row.embedding = new_vector
        else:
            self.db.add(
                MemoryEmbedding(
                    memory_id=target_uuid,
                    embedding=new_vector,
                    model_name=self.embedding_service.model_name,
                    dimension=self.embedding_service.dimension,
                )
            )

        self.db.add(
            MemoryEvent(
                memory_id=target_uuid,
                event_type="updated",
                details={"version": version_num, "re-embedded": True},
            )
        )
        await self.db.commit()
        return True

    async def _delete_internal(self, memory_id: str) -> bool:
        return await purge_memory_record(self.db, self.namespace_id, uuid.UUID(memory_id))

    async def _clear_internal(self) -> bool:
        return await purge_namespace_memories(self.db, self.namespace_id)