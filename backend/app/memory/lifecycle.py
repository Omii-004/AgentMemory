import uuid
from datetime import datetime, timezone
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import (
    Memory,
    MemoryEmbedding,
    MemoryEvent,
    MemoryFact,
    MemoryRelation,
    MemoryVersion,
)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Normalizes naive or offset datetimes to timezone-aware UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def purge_memory_record(
    db: AsyncSession, namespace_id: uuid.UUID, memory_id: uuid.UUID
) -> bool:
    """
    Purges a memory record and all derived/consolidated representations per DDD Section 14:
    - Allows deleting 'active', 'consolidated', and 'superseded' memories (rejects already 'deleted').
    - Transitively invalidates consolidated/child summaries referencing the target memory.
    - Hard-deletes embeddings, facts, versions, and relations.
    - Scrubs plaintext content ('[REDACTED]') while keeping content-free audit events.
    """
    res = await db.execute(
        select(Memory).where(
            Memory.id == memory_id,
            Memory.namespace_id == namespace_id,
            Memory.status != "deleted",
        )
    )
    target = res.scalars().first()
    if not target:
        return False

    # Transitively collect consolidated/child memories derived from the deleted target
    all_ids_set: set[uuid.UUID] = {memory_id}
    frontier: set[uuid.UUID] = {memory_id}
    while frontier:
        rel_res = await db.execute(
            select(MemoryRelation.source_memory_id)
            .join(Memory, Memory.id == MemoryRelation.source_memory_id)
            .where(
                MemoryRelation.target_memory_id.in_(frontier),
                MemoryRelation.relation_type == "derives_from",
                Memory.namespace_id == namespace_id,
                Memory.status != "deleted",
            )
        )
        parent_res = await db.execute(
            select(Memory.id).where(
                Memory.parent_memory_id.in_(frontier),
                Memory.namespace_id == namespace_id,
                Memory.status != "deleted",
            )
        )
        discovered = set(rel_res.scalars().all()) | set(parent_res.scalars().all())
        new_ids = {mid for mid in discovered if mid not in all_ids_set}
        if not new_ids:
            break
        all_ids_set.update(new_ids)
        frontier = new_ids

    derived_ids = [mid for mid in all_ids_set if mid != memory_id]
    all_ids = [memory_id, *derived_ids]
    now = datetime.now(timezone.utc)

    # Hard-delete derived and structured representations
    await db.execute(delete(MemoryEmbedding).where(MemoryEmbedding.memory_id.in_(all_ids)))
    await db.execute(delete(MemoryFact).where(MemoryFact.memory_id.in_(all_ids)))
    await db.execute(delete(MemoryVersion).where(MemoryVersion.memory_id.in_(all_ids)))
    await db.execute(
        delete(MemoryRelation).where(
            or_(
                MemoryRelation.source_memory_id.in_(all_ids),
                MemoryRelation.target_memory_id.in_(all_ids),
            )
        )
    )

    # Scrub canonical records while keeping content-free deletion audit events
    mem_res = await db.execute(
        select(Memory).where(Memory.id.in_(all_ids), Memory.namespace_id == namespace_id)
    )
    for mem in mem_res.scalars().all():
        mem.status = "deleted"
        mem.content = "[REDACTED]"
        mem.deleted_at = now

    db.add(
        MemoryEvent(
            memory_id=memory_id,
            event_type="deleted",
            details={"redacted": True, "derived_purged": len(derived_ids)},
        )
    )
    for d_id in derived_ids:
        db.add(
            MemoryEvent(
                memory_id=d_id,
                event_type="deleted",
                details={"redacted": True, "reason": "derived_source_deleted"},
            )
        )

    await db.commit()
    return True


async def purge_namespace_memories(db: AsyncSession, namespace_id: uuid.UUID) -> bool:
    """Purges all non-deleted memories and derived representations inside a namespace."""
    res = await db.execute(
        select(Memory.id).where(
            Memory.namespace_id == namespace_id,
            Memory.status != "deleted",
        )
    )
    mem_ids = list(res.scalars().all())
    if not mem_ids:
        return True

    now = datetime.now(timezone.utc)
    await db.execute(delete(MemoryEmbedding).where(MemoryEmbedding.memory_id.in_(mem_ids)))
    await db.execute(delete(MemoryFact).where(MemoryFact.memory_id.in_(mem_ids)))
    await db.execute(delete(MemoryVersion).where(MemoryVersion.memory_id.in_(mem_ids)))
    await db.execute(
        delete(MemoryRelation).where(
            or_(
                MemoryRelation.source_memory_id.in_(mem_ids),
                MemoryRelation.target_memory_id.in_(mem_ids),
            )
        )
    )

    mem_res = await db.execute(select(Memory).where(Memory.id.in_(mem_ids)))
    for mem in mem_res.scalars().all():
        mem.status = "deleted"
        mem.content = "[REDACTED]"
        mem.deleted_at = now

    await db.commit()
    return True