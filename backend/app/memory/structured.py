import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from sqlalchemy import func, or_, select

from app.database.models.memory import Memory, MemoryEvent, MemoryFact, MemoryRelation, MemoryVersion
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


class StructuredMemory(BaseMemory):
    """
    Structured Memory Architecture.
    Represents explicit facts as Subject-Predicate-Object triples with temporal validity bounds.
    Supports contradiction superseding, point-in-time temporal queries, and full versioning.
    """

    @property
    def architecture_type(self) -> str:
        return "structured"

    def _extract_triples_fallback(self, text: str) -> tuple[str, str, str]:
        """Rule-based triple extractor when explicit S-P-O attributes are not passed."""
        clean = text.strip().rstrip(".!?")
        patterns = [
            r"^(?P<sub>[\w\s]+?)\s+(?P<pred>prefers|uses|migrated to|switched to|is|works with|learned)\s+(?P<obj>[\w\s\.\-]+)$",
            r"^(?P<sub>[\w\s]+?)'s\s+(?P<pred>preferred \w+|\w+)\s+is\s+(?P<obj>[\w\s\.\-]+)$",
        ]
        for pattern in patterns:
            match = re.match(pattern, clean, re.IGNORECASE)
            if match:
                return (
                    match.group("sub").strip().title(),
                    match.group("pred").strip().lower(),
                    match.group("obj").strip(),
                )
        return ("User", "states", clean)

    def _get_reference_time(self) -> tuple[datetime, bool]:
        as_of = self.config.get("as_of")
        if isinstance(as_of, datetime):
            return ensure_utc(as_of) or datetime.now(timezone.utc), True
        if isinstance(as_of, str) and as_of.strip():
            parsed = datetime.fromisoformat(as_of.strip().replace("Z", "+00:00"))
            return ensure_utc(parsed) or datetime.now(timezone.utc), True
        return datetime.now(timezone.utc), False

    async def _store_internal(self, item: MemoryItem) -> list[str]:
        memory_id = uuid.uuid4()
        now = datetime.now(timezone.utc)

        if item.subject and item.predicate and item.object_value:
            sub, pred, obj = item.subject.strip(), item.predicate.strip(), item.object_value.strip()
        else:
            sub, pred, obj = self._extract_triples_fallback(item.content)

        valid_from = ensure_utc(item.valid_from) or now
        valid_to = ensure_utc(item.valid_to)

        # Only supersede overlapping active facts for real attributes (not generic 'states' notes)
        superseded_targets: list[tuple[MemoryFact, Memory]] = []
        if pred.lower() != "states" and (valid_to is None or valid_to > valid_from):
            existing_facts_stmt = (
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
            res = await self.db.execute(existing_facts_stmt)
            superseded_targets = list(res.all())

        memory = Memory(
            id=memory_id,
            namespace_id=self.namespace_id,
            source_message_id=item.source_message_id,
            parent_memory_id=item.parent_memory_id,
            memory_type="structured",
            content=f"{sub} {pred} {obj}",
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
                    details={"new_memory_id": str(memory_id)},
                )
            )

        self.db.add(
            MemoryFact(
                memory_id=memory_id,
                subject=sub,
                predicate=pred,
                object_value=obj,
                object_type="string",
                valid_from=valid_from,
                valid_to=valid_to,
                confidence=Decimal(str(item.confidence)) if item.confidence is not None else None,
            )
        )
        self.db.add(
            MemoryEvent(
                memory_id=memory_id,
                event_type="created",
                details={"subject": sub, "predicate": pred},
            )
        )
        await self.db.commit()
        return [str(memory_id)]

    async def _retrieve_internal(self, query: str, top_k: int = 5) -> list[RetrievedMemory]:
        ref_time, has_as_of = self._get_reference_time()
        allowed_statuses = ("active", "superseded") if has_as_of else ("active",)
        query_words = [
            tok for tok in _TOKEN_RE.findall(query.lower())
            if tok not in _STOP_WORDS and len(tok) > 1
        ]

        conditions: list[Any] = [
            Memory.namespace_id == self.namespace_id,
            Memory.status.in_(allowed_statuses),
            or_(MemoryFact.valid_from.is_(None), MemoryFact.valid_from <= ref_time),
            or_(MemoryFact.valid_to.is_(None), MemoryFact.valid_to > ref_time),
        ]

        keyword_filters: list[Any] = []
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
            .limit(max(top_k * 3, 25))
        )

        res = await self.db.execute(stmt)
        rows = res.all()

        ranked: list[tuple[int, int, float, datetime, RetrievedMemory]] = []
        for memory, fact in rows:
            fact_blob = f"{fact.subject} {fact.predicate} {fact.object_value}".lower()
            fact_tokens = set(_TOKEN_RE.findall(fact_blob))
            overlap = sum(1 for w in query_words if w in fact_tokens or w in fact_blob)
            if query_words and overlap == 0:
                continue

            is_explicit_attr = 1 if fact.predicate.lower() != "states" else 0
            conf_val = float(fact.confidence) if fact.confidence is not None else 1.0
            score = round(overlap / max(1, len(query_words)), 4) if query_words else 1.0

            ranked.append((
                overlap,
                is_explicit_attr,
                conf_val,
                memory.created_at,
                RetrievedMemory(
                    id=memory.id,
                    content=memory.content,
                    memory_type="structured",
                    score=score,
                    confidence=conf_val,
                    source_message_id=memory.source_message_id,
                    created_at=memory.created_at,
                    metadata={
                        "subject": fact.subject,
                        "predicate": fact.predicate,
                        "object_value": fact.object_value,
                        "valid_from": fact.valid_from.isoformat() if fact.valid_from else None,
                        "valid_to": fact.valid_to.isoformat() if fact.valid_to else None,
                        "as_of": ref_time.isoformat() if has_as_of else None,
                    },
                ),
            ))

        ranked.sort(key=lambda entry: (entry[0], entry[1], entry[2], entry[3]), reverse=True)
        return [entry[4] for entry in ranked[:top_k]]

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

        fact_stmt = select(MemoryFact).where(MemoryFact.memory_id == target_uuid)
        fact_res = await self.db.execute(fact_stmt)
        fact = fact_res.scalars().first()

        new_content = new_item.content
        if fact:
            if new_item.subject is not None:
                fact.subject = new_item.subject.strip()
            if new_item.predicate is not None:
                fact.predicate = new_item.predicate.strip()
            if new_item.object_value is not None:
                fact.object_value = new_item.object_value.strip()
            elif new_item.content:
                sub, pred, obj = self._extract_triples_fallback(new_item.content)
                if pred != "states":
                    if new_item.subject is None:
                        fact.subject = sub
                    if new_item.predicate is None:
                        fact.predicate = pred
                    fact.object_value = obj
                else:
                    fact.object_value = new_item.content.strip()

            if new_item.valid_from is not None:
                fact.valid_from = ensure_utc(new_item.valid_from)
            if new_item.valid_to is not None:
                fact.valid_to = ensure_utc(new_item.valid_to)
            if new_item.confidence is not None:
                fact.confidence = Decimal(str(new_item.confidence))

            if new_item.subject or new_item.predicate or new_item.object_value:
                new_content = f"{fact.subject} {fact.predicate} {fact.object_value}"
        elif new_item.subject and new_item.predicate and new_item.object_value:
            sub = new_item.subject.strip()
            pred = new_item.predicate.strip()
            obj = new_item.object_value.strip()
            self.db.add(
                MemoryFact(
                    memory_id=target_uuid,
                    subject=sub,
                    predicate=pred,
                    object_value=obj,
                    valid_from=ensure_utc(new_item.valid_from) or datetime.now(timezone.utc),
                    valid_to=ensure_utc(new_item.valid_to),
                    confidence=Decimal(str(new_item.confidence)) if new_item.confidence is not None else None,
                )
            )
            new_content = f"{sub} {pred} {obj}"

        self.db.add(
            MemoryVersion(
                memory_id=target_uuid,
                version_number=version_num,
                previous_content=memory.content,
                new_content=new_content,
                change_reason=new_item.metadata.get("change_reason", "structured_update"),
                changed_by="system",
            )
        )

        memory.content = new_content
        if new_item.importance is not None:
            memory.importance = Decimal(str(new_item.importance))
        if new_item.confidence is not None:
            memory.confidence = Decimal(str(new_item.confidence))

        self.db.add(
            MemoryEvent(
                memory_id=target_uuid,
                event_type="updated",
                details={"version": version_num},
            )
        )
        await self.db.commit()
        return True

    async def _delete_internal(self, memory_id: str) -> bool:
        return await purge_memory_record(self.db, self.namespace_id, uuid.UUID(memory_id))

    async def _clear_internal(self) -> bool:
        return await purge_namespace_memories(self.db, self.namespace_id)