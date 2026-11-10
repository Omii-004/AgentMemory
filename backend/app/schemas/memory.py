import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class NamespaceCreate(BaseModel):
    architecture_type: str = Field(pattern="^(history|vector|structured|hybrid)$")
    name: str = Field(min_length=1, max_length=150)
    config: dict[str, Any] = Field(default_factory=dict)


class NamespaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    config: dict[str, Any] | None = None


class NamespaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    architecture_type: str
    name: str
    config: dict[str, Any]
    created_at: datetime


class MemoryStoreRequest(BaseModel):
    namespace_id: uuid.UUID
    content: str = Field(min_length=1, max_length=50000)
    memory_type: str = "semantic"
    importance: float | None = Field(default=0.5, ge=0.0, le=1.0)
    confidence: float | None = Field(default=1.0, ge=0.0, le=1.0)
    subject: str | None = None
    predicate: str | None = None
    object_value: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryRetrieveRequest(BaseModel):
    namespace_id: uuid.UUID
    query: str = Field(min_length=1, max_length=10000)
    top_k: int = Field(default=5, ge=1, le=50)
    as_of: datetime | None = None


class MemoryUpdateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=50000)
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    subject: str | None = None
    predicate: str | None = None
    object_value: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    change_reason: str | None = "api_update"


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    namespace_id: uuid.UUID
    memory_type: str
    content: str
    importance: float | None
    confidence: float | None
    status: str
    created_at: datetime
    updated_at: datetime


class MemoryVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    memory_id: uuid.UUID
    version_number: int
    previous_content: str | None
    new_content: str
    change_reason: str | None
    created_at: datetime


class MemoryEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    memory_id: uuid.UUID
    event_type: str
    details: dict[str, Any]
    created_at: datetime