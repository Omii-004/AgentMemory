import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.database.models.benchmark import BenchmarkTask
    from app.database.models.experiment import ExperimentRun, RunArchitecture
    from app.database.models.user import Project


class TaskResult(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "task_results"

    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    run_architecture_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("run_architectures.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("benchmark_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    trial_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    generated_answer: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    expected_answer_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    task_status: Mapped[str] = mapped_column(String(30), nullable=False)  # success, failure, error, skipped
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    retrieval_latency_ms: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    llm_latency_ms: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    total_latency_ms: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retrieved_memory_ids: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    evaluation_details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    run: Mapped["ExperimentRun"] = relationship("ExperimentRun", back_populates="task_results")
    run_architecture: Mapped["RunArchitecture"] = relationship("RunArchitecture", back_populates="task_results")
    task: Mapped["BenchmarkTask"] = relationship("BenchmarkTask", back_populates="task_results")


class MetricResult(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "metric_results"

    run_architecture_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("run_architectures.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    metric_value: Mapped[Decimal] = mapped_column(Numeric(16, 8), nullable=False)
    metric_unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    run_architecture: Mapped["RunArchitecture"] = relationship("RunArchitecture", back_populates="metric_results")


class ExecutionTrace(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "execution_traces"

    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    task_result_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_results.id", ondelete="CASCADE"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)  # retrieval_started, retrieval_completed, llm_invoked
    component: Mapped[str] = mapped_column(String(80), nullable=False)
    event_data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    duration_ms: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)

    # Relationships
    run: Mapped["ExperimentRun"] = relationship("ExperimentRun", back_populates="traces")


class Report(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "reports"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    report_type: Mapped[str] = mapped_column(String(30), nullable=False)  # summary, architecture_comparison, failure_analysis
    file_location: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="completed", nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="reports")
    run: Mapped["ExperimentRun"] = relationship("ExperimentRun", back_populates="reports")