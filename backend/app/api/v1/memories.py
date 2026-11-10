import uuid
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, get_project_for_user
from app.core.exceptions import NotFoundException
from app.database.connection import get_db
from app.database.models.memory import Memory, MemoryEvent, MemoryNamespace, MemoryVersion
from app.database.models.user import Project, User
from app.memory.factory import get_memory_architecture
from app.memory.schemas import MemoryItem, MemoryOperationResult
from app.schemas.common import APIResponse
from app.schemas.memory import (
    MemoryEventResponse,
    MemoryResponse,
    MemoryRetrieveRequest,
    MemoryStoreRequest,
    MemoryUpdateRequest,
    MemoryVersionResponse,
    NamespaceCreate,
    NamespaceResponse,
    NamespaceUpdate,
)

router = APIRouter(tags=["Memory & Architectures"])


@router.get("/architectures", response_model=APIResponse[List[Dict[str, Any]]])
async def list_architectures():
    """Lists all built-in memory architectures and configurable options."""
    data = [
        {"type": "history", "name": "Conversation-History Memory", "default_config": {"window_size": 5}},
        {"type": "vector", "name": "Vector-Based Memory (pgvector)", "default_config": {"similarity_threshold": 0.0}},
        {"type": "structured", "name": "Structured Memory (S-P-O Facts)", "default_config": {}},
        {
            "type": "hybrid",
            "name": "Hybrid Memory (Multi-Factor Ranking)",
            "default_config": {
                "weight_similarity": 0.5,
                "weight_importance": 0.2,
                "weight_recency": 0.2,
                "weight_confidence": 0.1,
            },
        },
    ]
    return APIResponse(message="Available architectures retrieved", data=data)


@router.post("/projects/{project_id}/memory-namespaces", response_model=APIResponse[NamespaceResponse], status_code=status.HTTP_201_CREATED)
async def create_namespace(
    payload: NamespaceCreate,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    ns = MemoryNamespace(
        project_id=project.id,
        architecture_type=payload.architecture_type,
        name=payload.name,
        config=payload.config,
    )
    db.add(ns)
    await db.commit()
    await db.refresh(ns)
    return APIResponse(message="Memory namespace created", data=NamespaceResponse.model_validate(ns))


@router.get("/projects/{project_id}/memory-namespaces", response_model=APIResponse[List[NamespaceResponse]])
async def list_namespaces(project: Project = Depends(get_project_for_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(MemoryNamespace).where(MemoryNamespace.project_id == project.id))
    return APIResponse(message="Namespaces retrieved", data=[NamespaceResponse.model_validate(n) for n in res.scalars().all()])


async def _get_owned_namespace(namespace_id: uuid.UUID, db: AsyncSession, current_user: User) -> MemoryNamespace:
    stmt = (
        select(MemoryNamespace)
        .join(Project, MemoryNamespace.project_id == Project.id)
        .where(MemoryNamespace.id == namespace_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    ns = res.scalars().first()
    if not ns:
        raise NotFoundException("Memory namespace not found or access denied.")
    return ns


@router.get("/memory-namespaces/{namespace_id}", response_model=APIResponse[NamespaceResponse])
async def get_namespace(
    namespace_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    ns = await _get_owned_namespace(namespace_id, db, current_user)
    return APIResponse(message="Namespace retrieved", data=NamespaceResponse.model_validate(ns))


@router.patch("/memory-namespaces/{namespace_id}", response_model=APIResponse[NamespaceResponse])
async def update_namespace(
    namespace_id: uuid.UUID,
    payload: NamespaceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ns = await _get_owned_namespace(namespace_id, db, current_user)
    if payload.name is not None:
        ns.name = payload.name
    if payload.config is not None:
        ns.config = payload.config
    await db.commit()
    await db.refresh(ns)
    return APIResponse(message="Namespace updated", data=NamespaceResponse.model_validate(ns))


@router.post("/projects/{project_id}/memories", response_model=APIResponse[MemoryOperationResult], status_code=status.HTTP_201_CREATED)
async def store_memory(
    payload: MemoryStoreRequest,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ns = await _get_owned_namespace(payload.namespace_id, db, current_user)
    engine = get_memory_architecture(ns.architecture_type, db, ns.id, ns.config)
    result = await engine.store(
        MemoryItem(
            content=payload.content,
            memory_type=payload.memory_type,
            importance=payload.importance,
            confidence=payload.confidence,
            subject=payload.subject,
            predicate=payload.predicate,
            object_value=payload.object_value,
            metadata=payload.metadata,
        )
    )
    return APIResponse(message="Memory stored", data=result)


@router.post("/projects/{project_id}/memories/retrieve", response_model=APIResponse[MemoryOperationResult])
async def retrieve_memories(
    payload: MemoryRetrieveRequest,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ns = await _get_owned_namespace(payload.namespace_id, db, current_user)
    engine = get_memory_architecture(ns.architecture_type, db, ns.id, ns.config)
    result = await engine.retrieve(query=payload.query, top_k=payload.top_k)
    return APIResponse(message="Memories retrieved", data=result)


@router.get("/projects/{project_id}/memories", response_model=APIResponse[List[MemoryResponse]])
async def list_memories(
    namespace_id: uuid.UUID = Query(...),
    status_filter: str = Query(default="active"),
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ns = await _get_owned_namespace(namespace_id, db, current_user)
    stmt = select(Memory).where(Memory.namespace_id == ns.id, Memory.status == status_filter).order_by(Memory.created_at.desc())
    res = await db.execute(stmt)
    return APIResponse(message="Memories listed", data=[MemoryResponse.model_validate(m) for m in res.scalars().all()])


async def _get_owned_memory(memory_id: uuid.UUID, db: AsyncSession, current_user: User) -> tuple[Memory, MemoryNamespace]:
    stmt = (
        select(Memory, MemoryNamespace)
        .join(MemoryNamespace, Memory.namespace_id == MemoryNamespace.id)
        .join(Project, MemoryNamespace.project_id == Project.id)
        .where(Memory.id == memory_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise NotFoundException("Memory record not found or access denied.")
    return row[0], row[1]


@router.get("/memories/{memory_id}", response_model=APIResponse[MemoryResponse])
async def get_memory(memory_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    mem, _ = await _get_owned_memory(memory_id, db, current_user)
    return APIResponse(message="Memory retrieved", data=MemoryResponse.model_validate(mem))


@router.patch("/memories/{memory_id}", response_model=APIResponse[MemoryOperationResult])
async def update_memory(
    memory_id: uuid.UUID,
    payload: MemoryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mem, ns = await _get_owned_memory(memory_id, db, current_user)
    engine = get_memory_architecture(ns.architecture_type, db, ns.id, ns.config)
    res = await engine.update(
        str(mem.id),
        MemoryItem(
            content=payload.content,
            importance=payload.importance,
            confidence=payload.confidence,
            metadata={"change_reason": payload.change_reason},
        ),
    )
    return APIResponse(message="Memory updated", data=res)


@router.delete("/memories/{memory_id}", response_model=APIResponse[MemoryOperationResult])
async def delete_memory(
    memory_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    mem, ns = await _get_owned_memory(memory_id, db, current_user)
    engine = get_memory_architecture(ns.architecture_type, db, ns.id, ns.config)
    res = await engine.delete(str(mem.id))
    return APIResponse(message="Memory deleted and purged", data=res)


@router.get("/memories/{memory_id}/versions", response_model=APIResponse[List[MemoryVersionResponse]])
async def get_memory_versions(
    memory_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    mem, _ = await _get_owned_memory(memory_id, db, current_user)
    res = await db.execute(select(MemoryVersion).where(MemoryVersion.memory_id == mem.id).order_by(MemoryVersion.version_number.asc()))
    return APIResponse(message="Memory version history retrieved", data=[MemoryVersionResponse.model_validate(v) for v in res.scalars().all()])


@router.get("/memories/{memory_id}/events", response_model=APIResponse[List[MemoryEventResponse]])
async def get_memory_events(
    memory_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    mem, _ = await _get_owned_memory(memory_id, db, current_user)
    res = await db.execute(select(MemoryEvent).where(MemoryEvent.memory_id == mem.id).order_by(MemoryEvent.created_at.asc()))
    return APIResponse(message="Memory lifecycle events retrieved", data=[MemoryEventResponse.model_validate(e) for e in res.scalars().all()])