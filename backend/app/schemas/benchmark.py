import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field
from app.benchmark.schemas import BenchmarkTaskSchema


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    version: str = "1.0.0"
    description: Optional[str] = None
    is_public: bool = False


class DatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    version: str
    description: Optional[str]
    task_count: int
    is_public: bool
    created_at: datetime


class SyntheticGenerateRequest(BaseModel):
    tasks_per_category: int = Field(default=3, ge=1, le=100)
    distractor_count: int = Field(default=6, ge=0, le=100)
    seed: int = 42


class BulkTaskImportRequest(BaseModel):
    tasks: List[BenchmarkTaskSchema]


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    dataset_id: uuid.UUID
    task_key: str
    category: str
    difficulty: str
    conversation_sequence: List[Dict[str, Any]]
    evaluation_query: Dict[str, Any]
    created_at: datetime


class ExperimentCreate(BaseModel):
    dataset_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    architectures: List[str] = Field(default=["history", "vector", "structured", "hybrid"])
    llm_provider: str = "mock"
    llm_model: Optional[str] = None
    num_trials: int = Field(default=1, ge=1, le=10)
    architecture_configs: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class ExperimentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ExperimentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_id: uuid.UUID
    name: str
    description: Optional[str]
    configuration: Dict[str, Any]
    status: str
    created_at: datetime


class RunStartRequest(BaseModel):
    random_seed: Optional[int] = 42


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    experiment_id: uuid.UUID
    run_number: int
    status: str
    random_seed: Optional[int]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]
    created_at: datetime


class RunArchitectureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    namespace_id: uuid.UUID
    architecture_type: str
    configuration: Dict[str, Any]
    status: str
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class TaskResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_architecture_id: uuid.UUID
    task_id: uuid.UUID
    trial_number: int
    generated_answer: Optional[Dict[str, Any]]
    task_status: str
    is_correct: Optional[bool]
    retrieval_latency_ms: Optional[float]
    llm_latency_ms: Optional[float]
    total_latency_ms: Optional[float]
    total_tokens: Optional[int]
    retrieved_memory_ids: Optional[List[str]]
    evaluation_details: Dict[str, Any]


class MetricResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_architecture_id: uuid.UUID
    metric_name: str
    metric_value: float
    metric_unit: Optional[str]
    category: Optional[str]


class ExecutionTraceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    task_result_id: Optional[uuid.UUID]
    event_type: str
    component: str
    event_data: Dict[str, Any]
    duration_ms: Optional[float]
    created_at: datetime


class ReportCreateRequest(BaseModel):
    report_type: str = Field(default="json", pattern="^(json|csv)$")


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    run_id: uuid.UUID
    report_type: str
    file_location: Optional[str]
    status: str
    created_at: datetime