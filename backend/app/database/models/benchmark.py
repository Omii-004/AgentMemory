import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class BenchmarkDataset(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "benchmark_datasets"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(50), default="1.0.0", nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    task_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_public: Mapped[bool] = mapped_column(default=False, nullable=False)
    metadata_: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="benchmark_datasets")
    tasks: Mapped[List["BenchmarkTask"]] = relationship("BenchmarkTask", back_populates="dataset", cascade="all, delete-orphan")
    experiments: Mapped[List["Experiment"]] = relationship("Experiment", back_populates="dataset")


class BenchmarkTask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "benchmark_tasks"

    dataset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("benchmark_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    task_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)  # e.g. FACT_001
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)   # fact_retrieval, temporal_reasoning, etc.
    difficulty: Mapped[str] = mapped_column(String(30), default="medium", nullable=False)
    conversation_sequence: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    evaluation_query: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    expected_answer: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    required_memory_ids: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)
    metadata_: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    dataset: Mapped["BenchmarkDataset"] = relationship("BenchmarkDataset", back_populates="tasks")
    task_results: Mapped[List["TaskResult"]] = relationship("TaskResult", back_populates="task", cascade="all, delete-orphan")