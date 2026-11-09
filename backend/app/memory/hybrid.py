import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import Memory, MemoryEmbedding, MemoryEvent, MemoryFact, MemoryVersion
from app.embeddings.service import get_embedding_service
from app.memory.base import BaseMemory
from app.memory.schemas import MemoryItem, RetrievedMemory


class HybridMemory(BaseMemory):
    """
    Hybrid Memory Architecture.
    Combines episodic memory, semantic summaries, structured facts, and dense vector embeddings.
    Ranks retrieved candidates using a multi-factor formula specified in PRD Section 9.2:
        Score = w1 * Similarity + w2 * Importance + w3 * Recency + w4 * Confidence
    """

    def __init__(self, db: AsyncSession, namespace_id: uuid.UUID, config: Optional[Dict[str, Any]] = None):
        super().__init__(db, namespace_id, config)
        self.embedding_service = get_embedding_service()
        
        # Ranking weights (configurable via experiment config)
        self.w_sim: float = float(self.config.get("weight_similarity", 0.5))
        self.w_imp: float = float(self.config.get("weight_importance", 0.2))
        self.w_rec: float = float(self.config.get("weight_recency", 0.2))
        self.w_conf: float = float(self.config.get("weight_confidence", 0.1))
        
        # Exponential time-decay rate for recency calculation (half-life in hours)
        self.decay_rate: float = float(self.config.get("recency_decay_rate", 0.05))

    @property
    def architecture_type(self) -> str:
        return "hybrid"

    def _calculate_recency(self, created_at: datetime) -> float:
        now = datetime.now(timezone.utc)
        diff_hours = max(0.0, (now - created_at).total_seconds() / 3600.0)
        return math.exp(-self.decay_rate * diff_hours)

    async def _store_internal(self, item: MemoryItem) -> List[str]:
        memory_id = uuid.uuid4()
        now = datetime.now(timezone.utc)

        # 1. Canonical Memory
        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type=item.memory_type or "hybrid",
            content=item.content,
            importance=item.importance,
            confidence=item.confidence,
            status="active"
        )
        self.db.add(memory)

        # 2. Vector Embedding
        embedding_vector = await self.embedding_service.aembed_text(item.content)
        memory_embedding = MemoryEmbedding(
            memory_id=memory_id,
            embedding=embedding_vector,
            model_name=self.embedding_service.model_name,
            dimension=self.embedding_service.dimension
        )
        self.db.add(memory_embedding)

        # 3. Optional Structured Fact
        if item.subject and item.predicate and item.object_value:
            fact = MemoryFact(
                memory_id=memory_id,
                subject=item.subject,
                predicate=item.predicate,
                object_value=item.object_value,
                valid_from=item.valid_from or now,
                valid_to=item.valid_to,
                confidence=item.confidence
            )
            self.db.add(fact)

        event = MemoryEvent(
            memory_id=memory_id,
            event_type="created",
            details={"architecture": self.architecture_type}
        )
        self.db.add(event)
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> List[RetrievedMemory]:
        # Retrieve a broader candidate pool (top_k * 3) to allow multi-factor reranking
        candidate_limit = top_k * 3
        query_vector = await self.embedding_service.aembed_text(query)
        distance_expr = MemoryEmbedding.embedding.cosine_distance(query_vector).label("distance")

        stmt = (
            select(Memory, distance_expr)
            .join(MemoryEmbedding, Memory.id == MemoryEmbedding.memory_id)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status == "active"
            )
            .order_by(distance_expr.asc())
            .limit(candidate_limit)
        )
        res = await self.db.execute(stmt)
        candidates = res.all()

        scored_memories: List[RetrievedMemory] = []
        for memory, distance in candidates:
            # 1. Similarity
            similarity = max(0.0, 1.0 - float(distance))
            # 2. Importance
            importance = float(memory.importance) if memory.importance is not None else 0.5
            # 3. Recency
            recency = self._calculate_recency(memory.created_at)
            # 4. Confidence
            confidence = float(memory.confidence) if memory.confidence is not None else 1.0

            # Multi-factor scoring formula
            composite_score = (
                (self.w_sim * similarity) +
                (self.w_imp * importance) +
                (self.w_rec * recency) +
                (self.w_conf * confidence)
            )

            scored_memories.append(
                RetrievedMemory(
                    id=memory.id,
                    content=memory.content,
                    memory_type=memory.memory_type,
                    score=round(composite_score, 4),
                    similarity=round(similarity, 4),
                    importance=round(importance, 4),
                    recency=round(recency, 4),
                    confidence=round(confidence, 4),
                    source_message_id=memory.source_message_id,
                    created_at=memory.created_at,
                    metadata={"composite_score": composite_score}
                )
            )

        # Sort by composite score descending and take top_k
        scored_memories.sort(key=lambda m: m.score, reverse=True)
        return scored_memories[:top_k]

    async def _update_internal(self, memory_id: str, new_item: MemoryItem) -> bool:
        target_uuid = uuid.UUID(memory_id)
        stmt = select(Memory).where(
            Memory.id == target_uuid,
            Memory.namespace_id == self.namespace_id,
            Memory.status == "active"
        )
        res = await self.db.execute(stmt)
        memory = res.scalars().first()
        if not memory:
            return False

        # Versioning
        version = MemoryVersion(
            memory_id=target_uuid,
            version_number=1,
            previous_content=memory.content,
            new_content=new_item.content,
            change_reason="hybrid_update",
            changed_by="system"
        )
        self.db.add(version)

        memory.content = new_item.content
        if new_item.importance is not None:
            memory.importance = new_item.importance

        # Recompute embedding
        new_vector = await self.embedding_service.aembed_text(new_item.content)
        emb_stmt = select(MemoryEmbedding).where(MemoryEmbedding.memory_id == target_uuid)
        emb_res = await self.db.execute(emb_stmt)
        emb_row = emb_res.scalars().first()
        if emb_row:
            emb_row.embedding = new_vector

        await self.db.commit()
        return True

    async def _delete_internal(self, memory_id: str) -> bool:
        target_uuid = uuid.UUID(memory_id)
        stmt = select(Memory).where(
            Memory.id == target_uuid,
            Memory.namespace_id == self.namespace_id,
            Memory.status == "active"
        )
        res = await self.db.execute(stmt)
        memory = res.scalars().first()
        if not memory:
            return False

        memory.status = "deleted"
        memory.deleted_at = datetime.now(timezone.utc)
        # Purge vector embedding to prevent leakage
        await self.db.execute(delete(MemoryEmbedding).where(MemoryEmbedding.memory_id == target_uuid))
        await self.db.commit()
        return True

    async def _clear_internal(self) -> bool:
        stmt = select(Memory.id).where(Memory.namespace_id == self.namespace_id)
        res = await self.db.execute(stmt)
        ids = res.scalars().all()
        if ids:
            await self.db.execute(delete(MemoryEmbedding).where(MemoryEmbedding.memory_id.in_(ids)))
            upd = select(Memory).where(Memory.namespace_id == self.namespace_id)
            upd_res = await self.db.execute(upd)
            for m in upd_res.scalars().all():
                m.status = "deleted"
                m.deleted_at = datetime.now(timezone.utc)
            await self.db.commit()
        return True