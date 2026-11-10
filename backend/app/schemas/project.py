import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: str | None = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class SessionCreate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    session_type: str = "conversation"


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    name: str | None
    session_type: str
    created_at: datetime


class MessageCreate(BaseModel):
    role: str = Field(default="user", pattern="^(user|assistant|system|tool)$")
    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    session_id: uuid.UUID
    sequence_number: int
    role: str
    content: str
    created_at: datetime