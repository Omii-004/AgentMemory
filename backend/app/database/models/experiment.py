import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Experiment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "experiments"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("benchmark_datasets.id", ondelete="RESTRICT"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    configuration: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="experiments")
    dataset: Mapped["BenchmarkDataset"] = relationship("BenchmarkDataset", back_populates="experiments")
    runs: Mapped[List["ExperimentRun"]] = relationship("ExperimentRun", back_populates="experiment", cascade="all, delete-orphan")


class ExperimentRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "experiment_runs"

    experiment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False, index=True)
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)  # pending, running, completed, failed, cancelled
    random_seed: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    software_version: Mapped[Optional[str]] = mapped_column(String(100), default="1.0.0", nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    experiment: Mapped["Experiment"] = relationship("Experiment", back_populates="runs")
    run_architectures: Mapped[List["RunArchitecture"]] = relationship("RunArchitecture", back_populates="run", cascade="all, delete-orphan")
    task_results: Mapped[List["TaskResult"]] = relationship("TaskResult", back_populates="run", cascade="all, delete-orphan")
    traces: Mapped[List["ExecutionTrace"]] = relationship("ExecutionTrace", back_populates="run", cascade="all, delete-orphan")
    reports: Mapped[List["Report"]] = relationship("Report", back_populates="run", cascade="all, delete-orphan")


class RunArchitecture(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "run_architectures"

    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    namespace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memory_namespaces.id", ondelete="CASCADE"), nullable=False, index=True)
    architecture_type: Mapped[str] = mapped_column(String(30), nullable=False)
    configuration: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    run: Mapped["ExperimentRun"] = relationship("ExperimentRun", back_populates="run_architectures")
    namespace: Mapped["MemoryNamespace"] = relationship("MemoryNamespace")
    task_results: Mapped[List["TaskResult"]] = relationship("TaskResult", back_populates="run_architecture", cascade="all, delete-orphan")
    metric_results: Mapped[List["MetricResult"]] = relationship("MetricResult", back_populates="run_architecture", cascade="all, delete-orphan")