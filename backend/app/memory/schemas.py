import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MemoryItem(BaseModel):
    """Schema for storing a new piece of information into memory."""
    content: str
    memory_type: str = Field(default="semantic", description="episodic, semantic, structured")
    source_message_id: uuid.UUID | None = None
    parent_memory_id: uuid.UUID | None = None
    importance: float | None = Field(default=0.5, ge=0.0, le=1.0)
    confidence: float | None = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)
    
    # Optional structured fact attributes
    subject: str | None = None
    predicate: str | None = None
    object_value: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class RetrievedMemory(BaseModel):
    """Standardized representation of a memory returned from a retrieval operation."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content: str
    memory_type: str
    score: float = Field(default=1.0, description="Composite ranking score or similarity")
    similarity: float | None = None
    importance: float | None = None
    recency: float | None = None
    confidence: float | None = None
    source_message_id: uuid.UUID | None = None
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryOperationResult(BaseModel):
    """Traceable operation result schema specified in Benchmark Specification Section 9.2."""
    operation: str  # store, retrieve, update, delete, clear
    architecture: str  # history, vector, structured, hybrid
    status: str = "success"  # success, failure, error
    latency_ms: float
    retrieved_memories: list[RetrievedMemory] = Field(default_factory=list)
    retrieved_memory_ids: list[str] = Field(default_factory=list)
    affected_memory_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None