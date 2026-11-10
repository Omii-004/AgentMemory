import uuid
from decimal import Decimal
from sqlalchemy import desc, func, select

from app.database.models.memory import Memory, MemoryEvent, MemoryVersion
from app.memory.base import BaseMemory
from app.memory.lifecycle import purge_memory_record, purge_namespace_memories
from app.memory.schemas import MemoryItem, RetrievedMemory


class HistoryMemory(BaseMemory):
    """
    Conversation-History Memory Architecture.
    Represents the standard sliding-window baseline: stores sequential interaction turns
    and retrieves the most recent N memories.
    """

    @property
    def architecture_type(self) -> str:
        return "history"

    async def _store_internal(self, item: MemoryItem) -> list[str]:
        memory_id = uuid.uuid4()
        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type=item.memory_type or "episodic",
            content=item.content,
            importance=Decimal(str(item.importance)) if item.importance is not None else None,
            confidence=Decimal(str(item.confidence)) if item.confidence is not None else None,
            status="active",
        )
        self.db.add(memory)

        event = MemoryEvent(
            memory_id=memory_id,
            event_type="created",
            details={"architecture": self.architecture_type, "content_len": len(item.content)},
        )
        self.db.add(event)
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> list[RetrievedMemory]:
        window_size = int(self.config.get("window_size", top_k))
        limit = min(top_k, window_size)

        stmt = (
            select(Memory)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status == "active",
            )
            .order_by(desc(Memory.created_at))
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        memories = list(reversed(result.scalars().all()))  # Chronological order

        retrieved: list[RetrievedMemory] = []
        for idx, m in enumerate(memories):
            recency_score = (idx + 1) / len(memories) if memories else 1.0
            retrieved.append(
                RetrievedMemory(
                    id=m.id,
                    content=m.content,
                    memory_type=m.memory_type,
                    score=recency_score,
                    recency=recency_score,
                    importance=float(m.importance) if m.importance is not None else None,
                    confidence=float(m.confidence) if m.confidence is not None else None,
                    source_message_id=m.source_message_id,
                    created_at=m.created_at,
                    metadata={"position": idx},
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
        current_version_num = int(max_ver_res.scalar() or 0) + 1

        version = MemoryVersion(
            memory_id=target_uuid,
            version_number=current_version_num,
            previous_content=memory.content,
            new_content=new_item.content,
            change_reason=new_item.metadata.get("change_reason", "update"),
            changed_by="system",
        )
        self.db.add(version)

        memory.content = new_item.content
        if new_item.importance is not None:
            memory.importance = Decimal(str(new_item.importance))
        if new_item.confidence is not None:
            memory.confidence = Decimal(str(new_item.confidence))

        self.db.add(
            MemoryEvent(
                memory_id=target_uuid,
                event_type="updated",
                details={"version": current_version_num},
            )
        )
        await self.db.commit()
        return True

    async def _delete_internal(self, memory_id: str) -> bool:
        return await purge_memory_record(self.db, self.namespace_id, uuid.UUID(memory_id))

    async def _clear_internal(self) -> bool:
        return await purge_namespace_memories(self.db, self.namespace_id)