import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class NamespaceCreate(BaseModel):
    architecture_type: str = Field(pattern="^(history|vector|structured|hybrid)$")
    name: str = Field(min_length=1, max_length=150)
    config: Dict[str, Any] = Field(default_factory=dict)


class NamespaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    config: Optional[Dict[str, Any]] = None


class NamespaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    architecture_type: str
    name: str
    config: Dict[str, Any]
    created_at: datetime


class MemoryStoreRequest(BaseModel):
    namespace_id: uuid.UUID
    content: str = Field(min_length=1)
    memory_type: str = "semantic"
    importance: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)
    confidence: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    subject: Optional[str] = None
    predicate: Optional[str] = None
    object_value: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MemoryRetrieveRequest(BaseModel):
    namespace_id: uuid.UUID
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)


class MemoryUpdateRequest(BaseModel):
    content: str = Field(min_length=1)
    importance: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    change_reason: Optional[str] = "api_update"


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    namespace_id: uuid.UUID
    memory_type: str
    content: str
    importance: Optional[float]
    confidence: Optional[float]
    status: str
    created_at: datetime
    updated_at: datetime


class MemoryVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    memory_id: uuid.UUID
    version_number: int
    previous_content: Optional[str]
    new_content: str
    change_reason: Optional[str]
    created_at: datetime


class MemoryEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    memory_id: uuid.UUID
    event_type: str
    details: Dict[str, Any]
    created_at: datetime