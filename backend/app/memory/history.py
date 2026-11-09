import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import Memory, MemoryEvent, MemoryVersion
from app.memory.base import BaseMemory
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

    async def _store_internal(self, item: MemoryItem) -> List[str]:
        memory_id = uuid.uuid4()
        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type=item.memory_type or "episodic",
            content=item.content,
            importance=item.importance,
            confidence=item.confidence,
            status="active",
        )
        self.db.add(memory)

        # Audit event
        event = MemoryEvent(
            memory_id=memory_id,
            event_type="created",
            details={"architecture": self.architecture_type, "content_len": len(item.content)}
        )
        self.db.add(event)
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> List[RetrievedMemory]:
        # Default window_size can be overridden via config or query top_k
        window_size = self.config.get("window_size", top_k)
        limit = min(top_k, window_size)

        stmt = (
            select(Memory)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status == "active"
            )
            .order_by(desc(Memory.created_at))
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        memories = list(reversed(result.scalars().all()))  # Return in chronological order

        retrieved: List[RetrievedMemory] = []
        for idx, m in enumerate(memories):
            # Recency score normalized by position in the window (0.0 to 1.0)
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
                    metadata={"position": idx}
                )
            )

        return retrieved

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

        # Record version history
        version_count_stmt = select(MemoryVersion).where(MemoryVersion.memory_id == target_uuid)
        version_res = await self.db.execute(version_count_stmt)
        current_version_num = len(version_res.scalars().all()) + 1

        version = MemoryVersion(
            memory_id=target_uuid,
            version_number=current_version_num,
            previous_content=memory.content,
            new_content=new_item.content,
            change_reason=new_item.metadata.get("change_reason", "update"),
            changed_by="system"
        )
        self.db.add(version)

        # Update memory content
        memory.content = new_item.content
        if new_item.importance is not None:
            memory.importance = new_item.importance
        if new_item.confidence is not None:
            memory.confidence = new_item.confidence

        event = MemoryEvent(
            memory_id=target_uuid,
            event_type="updated",
            details={"version": current_version_num}
        )
        self.db.add(event)
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

        event = MemoryEvent(
            memory_id=target_uuid,
            event_type="deleted",
            details={"reason": "user_deletion_request"}
        )
        self.db.add(event)
        await self.db.commit()
        return True

    async def _clear_internal(self) -> bool:
        stmt = select(Memory).where(Memory.namespace_id == self.namespace_id)
        res = await self.db.execute(stmt)
        for m in res.scalars().all():
            m.status = "deleted"
            m.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True