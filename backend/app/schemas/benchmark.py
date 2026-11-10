import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.benchmark.schemas import BenchmarkTaskSchema

_ALLOWED_LLM_PROVIDERS = {"mock", "ollama", "openai", "openai_compatible", "openai-compatible"}


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    version: str = "1.0.0"
    description: str | None = None
    is_public: bool = False


class DatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    version: str
    description: str | None
    task_count: int
    is_public: bool
    created_at: datetime


class SyntheticGenerateRequest(BaseModel):
    tasks_per_category: int = Field(default=3, ge=1, le=100)
    distractor_count: int = Field(default=6, ge=0, le=100)
    seed: int = 42


class BulkTaskImportRequest(BaseModel):
    tasks: list[BenchmarkTaskSchema] = Field(min_length=1, max_length=1000)


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    dataset_id: uuid.UUID
    task_key: str
    category: str
    difficulty: str
    conversation_sequence: list[dict[str, Any]]
    evaluation_query: dict[str, Any]
    created_at: datetime


class ExperimentCreate(BaseModel):
    dataset_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    architectures: list[str] = Field(
        default_factory=lambda: ["history", "vector", "structured", "hybrid"],
        min_length=1,
    )
    llm_provider: str = "mock"
    llm_model: str | None = None
    num_trials: int = Field(default=1, ge=1, le=10)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=16, le=8192)
    architecture_configs: dict[str, dict[str, Any]] = Field(default_factory=dict)

    @field_validator("architectures")
    @classmethod
    def validate_unique_architectures(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("At least one memory architecture must be selected.")
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value:
            arch = raw.strip().lower()
            if not arch:
                raise ValueError("Architecture name cannot be blank.")
            if arch in seen:
                raise ValueError(f"Duplicate architecture '{arch}' is not allowed.")
            seen.add(arch)
            normalized.append(arch)
        return normalized

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, value: str) -> str:
        provider = value.strip().lower()
        if provider not in _ALLOWED_LLM_PROVIDERS:
            raise ValueError(
                f"Unsupported llm_provider '{value}'. Allowed: {sorted(_ALLOWED_LLM_PROVIDERS)}"
            )
        return provider


class ExperimentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ExperimentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_id: uuid.UUID
    name: str
    description: str | None
    configuration: dict[str, Any]
    status: str
    created_at: datetime


class RunStartRequest(BaseModel):
    random_seed: int | None = 42


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    experiment_id: uuid.UUID
    run_number: int
    status: str
    random_seed: int | None
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    created_at: datetime


class RunArchitectureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    namespace_id: uuid.UUID
    architecture_type: str
    configuration: dict[str, Any]
    status: str
    started_at: datetime | None
    completed_at: datetime | None


class TaskResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_architecture_id: uuid.UUID
    task_id: uuid.UUID
    trial_number: int
    generated_answer: dict[str, Any] | None
    task_status: str
    is_correct: bool | None
    retrieval_latency_ms: float | None
    llm_latency_ms: float | None
    total_latency_ms: float | None
    total_tokens: int | None
    retrieved_memory_ids: list[str] | None
    evaluation_details: dict[str, Any]


class MetricResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_architecture_id: uuid.UUID
    metric_name: str
    metric_value: float
    metric_unit: str | None
    category: str | None


class ExecutionTraceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    task_result_id: uuid.UUID | None
    event_type: str
    component: str
    event_data: dict[str, Any]
    duration_ms: float | None
    created_at: datetime


class ReportCreateRequest(BaseModel):
    report_type: str = Field(default="json", pattern="^(json|csv)$")


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    run_id: uuid.UUID
    report_type: str
    file_location: str | None
    status: str
    created_at: datetime