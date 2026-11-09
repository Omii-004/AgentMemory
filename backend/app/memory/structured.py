import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models.memory import Memory, MemoryEvent, MemoryFact, MemoryVersion
from app.memory.base import BaseMemory
from app.memory.schemas import MemoryItem, RetrievedMemory


class StructuredMemory(BaseMemory):
    """
    Structured Memory Architecture.
    Represents explicit facts as Subject-Predicate-Object triples with temporal validity bounds.
    Specialized for Benchmark Category B (Temporal Reasoning), C (Contradiction Handling),
    and E (Memory Updating).
    """

    @property
    def architecture_type(self) -> str:
        return "structured"

    def _extract_triples_fallback(self, text: str) -> tuple[str, str, str]:
        """Simple rule-based heuristic extractor when explicit triple attributes are not passed."""
        # Check patterns like "User prefers Python", "Project database is PostgreSQL", etc.
        patterns = [
            r"^(?P<sub>[\w\s]+?)\s+(?P<pred>prefers|uses|migrated to|switched to|is|works with|learned)\s+(?P<obj>[\w\s\.\-]+)$",
            r"^(?P<sub>[\w\s]+?)\'s\s+(?P<pred>preferred \w+|\w+)\s+is\s+(?P<obj>[\w\s\.\-]+)$",
        ]
        for pattern in patterns:
            match = re.match(pattern, text.strip(), re.IGNORECASE)
            if match:
                return (
                    match.group("sub").strip().title(),
                    match.group("pred").strip().lower(),
                    match.group("obj").strip()
                )
        # Default fallback triple
        return ("User", "states", text.strip())

    async def _store_internal(self, item: MemoryItem) -> List[str]:
        memory_id = uuid.uuid4()
        now = datetime.now(timezone.utc)

        # 1. Determine Subject, Predicate, Object
        if item.subject and item.predicate and item.object_value:
            sub, pred, obj = item.subject, item.predicate, item.object_value
        else:
            sub, pred, obj = self._extract_triples_fallback(item.content)

        valid_from = item.valid_from or now
        valid_to = item.valid_to

        # 2. Check for existing facts with the same Subject + Predicate (Contradiction/Update Handling)
        existing_facts_stmt = (
            select(MemoryFact)
            .join(Memory, MemoryFact.memory_id == Memory.id)
            .where(
                Memory.namespace_id == self.namespace_id,
                Memory.status == "active",
                MemoryFact.subject.ilike(sub),
                MemoryFact.predicate.ilike(pred),
                or_(MemoryFact.valid_to.is_(None), MemoryFact.valid_to > now)
            )
        )
        res = await self.db.execute(existing_facts_stmt)
        existing_facts = res.scalars().all()

        for old_fact in existing_facts:
            # Supersede old fact: set valid_to = valid_from of new fact
            old_fact.valid_to = valid_from
            event = MemoryEvent(
                memory_id=old_fact.memory_id,
                event_type="superseded",
                details={"new_memory_id": str(memory_id), "new_value": obj}
            )
            self.db.add(event)

        # 3. Create canonical Memory record
        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type="structured",
            content=f"{sub} {pred} {obj}",
            importance=item.importance,
            confidence=item.confidence,
            status="active"
        )
        self.db.add(memory)

        # 4. Create Structured Fact record
        fact = MemoryFact(
            memory_id=memory_id,
            subject=sub,
            predicate=pred,
            object_value=obj,
            object_type="string",
            valid_from=valid_from,
            valid_to=valid_to,
            confidence=item.confidence
        )
        self.db.add(fact)

        event = MemoryEvent(
            memory_id=memory_id,
            event_type="created",
            details={"subject": sub, "predicate": pred, "object": obj}
        )
        self.db.add(event)
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> List[RetrievedMemory]:
        now = datetime.now(timezone.utc)
        query_words = [w.strip().lower() for w in query.split() if len(w.strip()) > 2]

        # Filter active facts that are currently valid
        conditions = [
            Memory.namespace_id == self.namespace_id,
            Memory.status == "active",
            or_(MemoryFact.valid_from.is_(None), MemoryFact.valid_from <= now),
            or_(MemoryFact.valid_to.is_(None), MemoryFact.valid_to > now)
        ]

        # Match query keywords against subject, predicate, or object
        keyword_filters = []
        for word in query_words:
            keyword_filters.append(MemoryFact.subject.ilike(f"%{word}%"))
            keyword_filters.append(MemoryFact.predicate.ilike(f"%{word}%"))
            keyword_filters.append(MemoryFact.object_value.ilike(f"%{word}%"))

        if keyword_filters:
            conditions.append(or_(*keyword_filters))

        stmt = (
            select(Memory, MemoryFact)
            .join(MemoryFact, Memory.id == MemoryFact.memory_id)
            .where(*conditions)
            .order_by(Memory.created_at.desc())
            .limit(top_k)
        )

        res = await self.db.execute(stmt)
        rows = res.all()

        retrieved: List[RetrievedMemory] = []
        for memory, fact in rows:
            retrieved.append(
                RetrievedMemory(
                    id=memory.id,
                    content=memory.content,
                    memory_type="structured",
                    score=1.0,
                    confidence=float(fact.confidence) if fact.confidence is not None else 1.0,
                    source_message_id=memory.source_message_id,
                    created_at=memory.created_at,
                    metadata={
                        "subject": fact.subject,
                        "predicate": fact.predicate,
                        "object_value": fact.object_value,
                        "valid_from": fact.valid_from.isoformat() if fact.valid_from else None,
                        "valid_to": fact.valid_to.isoformat() if fact.valid_to else None,
                    }
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

        # Versioning
        version = MemoryVersion(
            memory_id=target_uuid,
            version_number=1,
            previous_content=memory.content,
            new_content=new_item.content,
            change_reason="structured_update",
            changed_by="system"
        )
        self.db.add(version)

        memory.content = new_item.content
        fact_stmt = select(MemoryFact).where(MemoryFact.memory_id == target_uuid)
        fact_res = await self.db.execute(fact_stmt)
        fact = fact_res.scalars().first()
        if fact and new_item.object_value:
            fact.object_value = new_item.object_value

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