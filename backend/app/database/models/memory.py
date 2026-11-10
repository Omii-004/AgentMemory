import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.database.models.user import Project


class MemoryNamespace(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_namespaces"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=True, index=True)
    architecture_type: Mapped[str] = mapped_column(String(30), nullable=False)  # history, vector, structured, hybrid
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="memory_namespaces")
    memories: Mapped[list["Memory"]] = relationship("Memory", back_populates="namespace", cascade="all, delete-orphan")


class Memory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memories"

    namespace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memory_namespaces.id", ondelete="CASCADE"), nullable=False, index=True)
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_memory_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="SET NULL"), nullable=True, index=True)
    memory_type: Mapped[str] = mapped_column(String(30), nullable=False)  # episodic, semantic, structured
    content: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)  # active, superseded, deleted, consolidated
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    namespace: Mapped["MemoryNamespace"] = relationship("MemoryNamespace", back_populates="memories")
    facts: Mapped[list["MemoryFact"]] = relationship("MemoryFact", back_populates="memory", cascade="all, delete-orphan")
    versions: Mapped[list["MemoryVersion"]] = relationship("MemoryVersion", back_populates="memory", cascade="all, delete-orphan")
    embeddings: Mapped[list["MemoryEmbedding"]] = relationship("MemoryEmbedding", back_populates="memory", cascade="all, delete-orphan")
    events: Mapped[list["MemoryEvent"]] = relationship("MemoryEvent", back_populates="memory", cascade="all, delete-orphan")


class MemoryFact(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_facts"

    memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    predicate: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    object_value: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str] = mapped_column(String(50), default="string", nullable=False)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="facts")


class MemoryVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_versions"

    memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_content: Mapped[str] = mapped_column(Text, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    changed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="versions")


class MemoryEmbedding(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_embeddings"

    memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding = mapped_column(Vector(384), nullable=False)
    model_name: Mapped[str] = mapped_column(String(150), default="sentence-transformers/all-MiniLM-L6-v2", nullable=False)
    dimension: Mapped[int] = mapped_column(Integer, default=384, nullable=False)

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="embeddings")


class MemoryRelation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_relations"

    source_memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    target_memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    relation_type: Mapped[str] = mapped_column(String(100), nullable=False)  # supports, contradicts, updates, derives_from
    weight: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("1.0"), nullable=False)


class MemoryEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memory_events"

    memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)  # created, retrieved, updated, deleted, consolidated
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="events")