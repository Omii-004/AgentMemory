import uuid
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.database.models.memory import (
    Memory,
    MemoryEmbedding,
    MemoryEvent,
    MemoryNamespace,
    MemoryRelation,
)
from app.embeddings.service import get_embedding_service
from app.llm.factory import get_llm_adapter

logger = get_logger(__name__)


class ConsolidationResult(BaseModel):
    status: str
    consolidated_memory_id: str | None = None
    source_count: int = 0
    summary_content: str = ""
    source_memory_ids: list[str] = []


class MemoryConsolidator:
    """
    Combines multiple active memories within a namespace into a single
    compact semantic summary while preserving source provenance (PRD Section 9.5).
    """

    def __init__(self, db: AsyncSession, namespace_id: uuid.UUID):
        self.db = db
        self.namespace_id = namespace_id

    async def consolidate(
        self, min_memories: int = 2, llm_provider: str | None = None
    ) -> ConsolidationResult:
        try:
            # 1. Inspect namespace architecture
            ns_res = await self.db.execute(
                select(MemoryNamespace).where(MemoryNamespace.id == self.namespace_id)
            )
            ns = ns_res.scalars().first()
            if not ns:
                return ConsolidationResult(status="error")

            # 2. Fetch active memories eligible for consolidation
            mem_res = await self.db.execute(
                select(Memory)
                .where(Memory.namespace_id == self.namespace_id, Memory.status == "active")
                .order_by(Memory.created_at.asc())
            )
            sources = list(mem_res.scalars().all())
            if len(sources) < min_memories:
                return ConsolidationResult(
                    status="skipped",
                    source_count=len(sources),
                    summary_content="Insufficient active memories to consolidate.",
                )

            # 3. Synthesize factual summary without inventing unstated information
            raw_lines = [m.content.strip() for m in sources]
            effective_provider = (llm_provider or settings.LLM_PROVIDER or "mock").lower()
            if effective_provider == "mock":
                unique_facts = list(dict.fromkeys(raw_lines))
                summary_text = "Consolidated Knowledge: " + " | ".join(unique_facts)
            else:
                llm = get_llm_adapter(provider=effective_provider)
                prompt = (
                    "Combine the following memories into one concise, accurate summary. "
                    "Do NOT invent any new facts not explicitly stated below:\n\n"
                    + "\n".join(f"- {line}" for line in raw_lines)
                )
                llm_res = await llm.generate(prompt=prompt)
                summary_text = llm_res.text.strip()

            # 4. Create the consolidated semantic memory
            consolidated_id = uuid.uuid4()
            max_imp = max((m.importance for m in sources if m.importance is not None), default=Decimal("0.8"))
            consolidated_mem = Memory(
                id=consolidated_id,
                namespace_id=self.namespace_id,
                memory_type="semantic",
                content=summary_text,
                importance=max_imp,
                confidence=Decimal("1.0"),
                status="active",
            )
            self.db.add(consolidated_mem)

            # 5. Generate new vector embedding if architecture uses vectors
            if ns.architecture_type in ("vector", "hybrid"):
                emb_service = get_embedding_service()
                vec = await emb_service.aembed_text(summary_text)
                self.db.add(
                    MemoryEmbedding(
                        memory_id=consolidated_id,
                        embedding=vec,
                        model_name=emb_service.model_name,
                        dimension=emb_service.dimension,
                    )
                )

            # 6. Link provenance relations and mark raw source episodes as 'consolidated'
            source_ids: list[str] = []
            for src in sources:
                source_ids.append(str(src.id))
                src.status = "consolidated"
                self.db.add(
                    MemoryRelation(
                        source_memory_id=consolidated_id,
                        target_memory_id=src.id,
                        relation_type="derives_from",
                        weight=Decimal("1.0"),
                    )
                )
                self.db.add(
                    MemoryEvent(
                        memory_id=src.id,
                        event_type="consolidated",
                        details={"consolidated_into": str(consolidated_id)},
                    )
                )

            # Remove redundant embeddings from consolidated sources so top-K stays clean
            await self.db.execute(
                delete(MemoryEmbedding).where(MemoryEmbedding.memory_id.in_([m.id for m in sources]))
            )

            self.db.add(
                MemoryEvent(
                    memory_id=consolidated_id,
                    event_type="consolidated",
                    details={"source_count": len(sources), "source_ids": source_ids},
                )
            )
            await self.db.commit()

            return ConsolidationResult(
                status="success",
                consolidated_memory_id=str(consolidated_id),
                source_count=len(sources),
                summary_content=summary_text,
                source_memory_ids=source_ids,
            )
        except Exception:
            logger.exception("Memory consolidation failed for namespace %s", self.namespace_id)
            try:
                await self.db.rollback()
            except (SQLAlchemyError, RuntimeError, OSError) as rb_err:
                logger.warning("Rollback after consolidation error failed: %s", rb_err)
            return ConsolidationResult(status="error")