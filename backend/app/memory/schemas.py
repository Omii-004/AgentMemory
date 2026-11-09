import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class MemoryItem(BaseModel):
    """Schema for storing a new piece of information into memory."""
    content: str
    memory_type: str = Field(default="semantic", description="episodic, semantic, structured")
    source_message_id: Optional[uuid.UUID] = None
    parent_memory_id: Optional[uuid.UUID] = None
    importance: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)
    confidence: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    # Optional structured fact attributes
    subject: Optional[str] = None
    predicate: Optional[str] = None
    object_value: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None


class RetrievedMemory(BaseModel):
    """Standardized representation of a memory returned from a retrieval operation."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content: str
    memory_type: str
    score: float = Field(default=1.0, description="Composite ranking score or similarity")
    similarity: Optional[float] = None
    importance: Optional[float] = None
    recency: Optional[float] = None
    confidence: Optional[float] = None
    source_message_id: Optional[uuid.UUID] = None
    created_at: datetime
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MemoryOperationResult(BaseModel):
    """Traceable operation result schema specified in Benchmark Specification Section 9.2."""
    operation: str  # store, retrieve, update, delete, clear
    architecture: str  # history, vector, structured, hybrid
    status: str = "success"  # success, failure, error
    latency_ms: float
    retrieved_memories: List[RetrievedMemory] = Field(default_factory=list)
    retrieved_memory_ids: List[str] = Field(default_factory=list)
    affected_memory_ids: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None