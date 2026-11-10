import math
import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import (
    Memory,
    MemoryEmbedding,
    MemoryEvent,
    MemoryFact,
    MemoryRelation,
    MemoryVersion,
)
from app.embeddings.service import get_embedding_service
from app.memory.base import BaseMemory
from app.memory.lifecycle import ensure_utc, purge_memory_record, purge_namespace_memories
from app.memory.schemas import MemoryItem, RetrievedMemory

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "what", "which", "who", "when", "where", "why", "how",
    "is", "are", "was", "were", "do", "does", "did",
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "as", "by",
    "my", "our", "your", "their", "its", "this", "that", "list", "currently",
}


class HybridMemory(BaseMemory):
    """
    Hybrid Memory Architecture.
    Combines episodic/semantic memories, structured facts (with contradiction superseding
    and temporal validity), and dense vector embeddings under multi-factor weighted scoring:
        Score = w1 * Similarity + w2 * Importance + w3 * Recency + w4 * Confidence (+ Fact Boost)
    """

    def __init__(self, db: AsyncSession, namespace_id: uuid.UUID, config: dict[str, Any] | None = None):
        super().__init__(db, namespace_id, config)
        self.embedding_service = get_embedding_service()

        self.w_sim: float = float(self.config.get("weight_similarity", 0.5))
        self.w_imp: float = float(self.config.get("weight_importance", 0.2))
        self.w_rec: float = float(self.config.get("weight_recency", 0.2))
        self.w_conf: float = float(self.config.get("weight_confidence", 0.1))
        self.decay_rate: float = float(self.config.get("recency_decay_rate", 0.05))

    @property
    def architecture_type(self) -> str:
        return "hybrid"

    def _calculate_recency(self, created_at: datetime, ref_time: datetime | None = None) -> float:
        now = ref_time or datetime.now(UTC)
        created_utc = ensure_utc(created_at) or now
        diff_hours = max(0.0, (now - created_utc).total_seconds() / 3600.0)
        return math.exp(-self.decay_rate * diff_hours)

    def _get_reference_time(self) -> tuple[datetime, bool]:
        as_of = self.config.get("as_of")
        if isinstance(as_of, datetime):
            return ensure_utc(as_of) or datetime.now(UTC), True
        if isinstance(as_of, str) and as_of.strip():
            parsed = datetime.fromisoformat(as_of.strip())
            return ensure_utc(parsed) or datetime.now(UTC), True
        return datetime.now(UTC), False

    @staticmethod
    def _is_fact_valid_at(fact: MemoryFact, ref_time: datetime) -> bool:
      vf = ensure_utc(fact.valid_from)
      vt = ensure_utc(fact.valid_to)
      if vf is not None and vf > ref_time:
          return False
      return not (vt is not None and vt <= ref_time)

    async def _store_internal(self, item: MemoryItem) -> list[str]:
        memory_id = uuid.uuid4()
        now = datetime.now(UTC)
        valid_from = ensure_utc(item.valid_from) or now
        valid_to = ensure_utc(item.valid_to)

        superseded_targets: list[tuple[MemoryFact, Memory]] = []
        if item.subject and item.predicate and item.object_value:
            sub = item.subject.strip()
            pred = item.predicate.strip()
            if pred.lower() != "states" and (valid_to is None or valid_to > valid_from):
                existing_stmt = (
                    select(MemoryFact, Memory)
                    .join(Memory, MemoryFact.memory_id == Memory.id)
                    .where(
                        Memory.namespace_id == self.namespace_id,
                        Memory.status == "active",
                        MemoryFact.subject.ilike(sub),
                        MemoryFact.predicate.ilike(pred),
                        or_(MemoryFact.valid_from.is_(None), MemoryFact.valid_from <= valid_from),
                        or_(MemoryFact.valid_to.is_(None), MemoryFact.valid_to > valid_from),
                    )
                )
                res = await self.db.execute(existing_stmt)
                superseded_targets = list(res.all())

        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type=item.memory_type or "hybrid",
            content=item.content,
            importance=Decimal(str(item.importance)) if item.importance is not None else None,
            confidence=Decimal(str(item.confidence)) if item.confidence is not None else None,
            status="active",
        )
        self.db.add(memory)

        for old_fact, old_mem in superseded_targets:
            old_fact.valid_to = valid_from
            old_mem.status = "superseded"
            self.db.add(
                MemoryRelation(
                    source_memory_id=memory_id,
                    target_memory_id=old_mem.id,
                    relation_type="updates",
                    weight=Decimal("1.0"),
                )
            )
            self.db.add(
                MemoryEvent(
                    memory_id=old_mem.id,
                    event_type="superseded",
                    details={"superseded_by": str(memory_id)},
                )
            )

        embedding_vector = await self.embedding_service.aembed_text(item.content)
        self.db.add(
            MemoryEmbedding(
                memory_id=memory_id,
                embedding=embedding_vector,
                model_name=self.embedding_service.model_name,
                dimension=self.embedding_service.dimension,
            )
        )

        if item.subject and item.predicate and item.object_value:
            self.db.add(
                MemoryFact(
                    memory_id=memory_id,
                    subject=item.subject.strip(),
                    predicate=item.predicate.strip(),
                    object_value=item.object_value.strip(),
                    valid_from=valid_from,
                    valid_to=valid_to,
                    confidence=Decimal(str(item.confidence)) if item.confidence is not None else None,
                )
            )

        self.db.add(
            MemoryEvent(
                memory_id=memory_id,
                event_type="created",
                details={"architecture": self.architecture_type},
            )
        )
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> list[RetrievedMemory]:
        ref_time, has_as_of = self._get_reference_time()
        allowed_statuses = ("active", "superseded") if has_as_of else ("active",)
        candidate_limit = top_k * 3
        query_vector = await self.embedding_service.aembed_text(query)
        distance_expr = MemoryEmbedding.embedding.cosine_distance(query_vector).label("distance")

        # 1. Vector candidate pool + temporal validity check on any attached fact
        vec_stmt = (
            select(Memory, MemoryFact, distance_expr)
            .join(MemoryEmbedding, Memory.id == MemoryEmbedding.memory_id)
            .outerjoin(MemoryFact, Memory.id == MemoryFact.memory_id)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status.in_(allowed_statuses),
            )
            .order_by(distance_expr.asc())
            .limit(candidate_limit)
        )
        vec_rows = (await self.db.execute(vec_stmt)).all()

        merged: dict[uuid.UUID, tuple[Memory, MemoryFact | None, float, float]] = {}
        for memory, fact, distance in vec_rows:
            if fact is not None:
                if not self._is_fact_valid_at(fact, ref_time):
                    continue
            elif has_as_of:
                created_utc = ensure_utc(memory.created_at)
                if created_utc is not None and created_utc > ref_time:
                    continue

            similarity = max(0.0, 1.0 - float(distance))
            merged[memory.id] = (memory, fact, similarity, 0.0)

        # 2. Structured fact candidate pool (keyword match against temporally valid facts)
        query_words = [
            tok for tok in _TOKEN_RE.findall(query.lower())
            if tok not in _STOP_WORDS and len(tok) > 1
        ]
        if query_words:
            kw_filters: list[Any] = []
            for word in query_words:
                kw_filters.append(MemoryFact.subject.ilike(f"%{word}%"))
                kw_filters.append(MemoryFact.predicate.ilike(f"%{word}%"))
                kw_filters.append(MemoryFact.object_value.ilike(f"%{word}%"))

            fact_stmt = (
                select(Memory, MemoryFact, distance_expr)
                .join(MemoryFact, Memory.id == MemoryFact.memory_id)
                .outerjoin(MemoryEmbedding, Memory.id == MemoryEmbedding.memory_id)
                .where(
                    Memory.namespace_id == self.namespace_id,
                    Memory.status.in_(allowed_statuses),
                    or_(MemoryFact.valid_from.is_(None), MemoryFact.valid_from <= ref_time),
                    or_(MemoryFact.valid_to.is_(None), MemoryFact.valid_to > ref_time),
                    or_(*kw_filters),
                )
                .limit(top_k * 2)
            )
            fact_rows = (await self.db.execute(fact_stmt)).all()
            for memory, fact, distance in fact_rows:
                sim = max(0.0, 1.0 - float(distance)) if distance is not None else 0.5
                fact_text = f"{fact.subject} {fact.predicate} {fact.object_value}".lower()
                hits = sum(1 for w in query_words if w in fact_text)
                fact_boost = 0.15 * min(1.0, hits / max(1, len(query_words)))
                if memory.id in merged:
                    prev_sim = merged[memory.id][2]
                    merged[memory.id] = (memory, fact, max(prev_sim, sim), fact_boost)
                else:
                    merged[memory.id] = (memory, fact, sim, fact_boost)

        scored_memories: list[RetrievedMemory] = []
        for memory, fact, similarity, fact_boost in merged.values():
            importance = float(memory.importance) if memory.importance is not None else 0.5
            recency = self._calculate_recency(memory.created_at, ref_time=ref_time)
            confidence = float(memory.confidence) if memory.confidence is not None else 1.0

            composite_score = (
                (self.w_sim * similarity)
                + (self.w_imp * importance)
                + (self.w_rec * recency)
                + (self.w_conf * confidence)
                + fact_boost
            )

            meta: dict[str, Any] = {"composite_score": round(composite_score, 4)}
            if fact is not None:
                meta.update({
                    "subject": fact.subject,
                    "predicate": fact.predicate,
                    "object_value": fact.object_value,
                    "valid_from": fact.valid_from.isoformat() if fact.valid_from else None,
                    "valid_to": fact.valid_to.isoformat() if fact.valid_to else None,
                })
            if has_as_of:
                meta["as_of"] = ref_time.isoformat()

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
                    metadata=meta,
                )
            )

        scored_memories.sort(key=lambda m: m.score, reverse=True)
        return scored_memories[:top_k]

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
                change_reason=new_item.metadata.get("change_reason", "hybrid_update"),
                changed_by="system",
            )
        )

        memory.content = new_item.content
        if new_item.importance is not None:
            memory.importance = Decimal(str(new_item.importance))
        if new_item.confidence is not None:
            memory.confidence = Decimal(str(new_item.confidence))

        fact_stmt = select(MemoryFact).where(MemoryFact.memory_id == target_uuid)
        fact = (await self.db.execute(fact_stmt)).scalars().first()
        if fact:
            if new_item.subject is not None:
                fact.subject = new_item.subject.strip()
            if new_item.predicate is not None:
                fact.predicate = new_item.predicate.strip()
            if new_item.object_value is not None:
                fact.object_value = new_item.object_value.strip()
            elif new_item.content:
                fact.object_value = new_item.content.strip()
            if new_item.valid_from is not None:
                fact.valid_from = ensure_utc(new_item.valid_from)
            if new_item.valid_to is not None:
                fact.valid_to = ensure_utc(new_item.valid_to)
            if new_item.confidence is not None:
                fact.confidence = Decimal(str(new_item.confidence))
        elif new_item.subject and new_item.predicate and new_item.object_value:
            self.db.add(
                MemoryFact(
                    memory_id=target_uuid,
                    subject=new_item.subject.strip(),
                    predicate=new_item.predicate.strip(),
                    object_value=new_item.object_value.strip(),
                    valid_from=ensure_utc(new_item.valid_from) or datetime.now(UTC),
                    valid_to=ensure_utc(new_item.valid_to),
                    confidence=Decimal(str(new_item.confidence)) if new_item.confidence is not None else None,
                )
            )

        new_vector = await self.embedding_service.aembed_text(new_item.content)
        emb_stmt = select(MemoryEmbedding).where(MemoryEmbedding.memory_id == target_uuid)
        emb_row = (await self.db.execute(emb_stmt)).scalars().first()
        if emb_row:
            emb_row.embedding = new_vector
            emb_row.model_name = self.embedding_service.model_name
            emb_row.dimension = self.embedding_service.dimension
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