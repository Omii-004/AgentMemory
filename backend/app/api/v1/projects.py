import math
import uuid
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, get_project_for_user
from app.core.exceptions import NotFoundException
from app.database.connection import get_db
from app.database.models.conversation import Message, Session
from app.database.models.user import Project, User
from app.schemas.common import APIResponse, PaginatedResponse, PaginationMeta
from app.schemas.project import (
    MessageCreate,
    MessageResponse,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    SessionCreate,
    SessionResponse,
)

router = APIRouter(tags=["Projects & Conversations"])


@router.post("/projects", response_model=APIResponse[ProjectResponse], status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = Project(owner_id=current_user.id, name=payload.name, description=payload.description)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return APIResponse(message="Project created successfully", data=ProjectResponse.model_validate(project))


@router.get("/projects", response_model=PaginatedResponse[ProjectResponse])
async def list_projects(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count_res = await db.execute(select(func.count(Project.id)).where(Project.owner_id == current_user.id))
    total_items = count_res.scalar() or 0
    total_pages = max(1, math.ceil(total_items / page_size))

    stmt = (
        select(Project)
        .where(Project.owner_id == current_user.id)
        .order_by(Project.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    res = await db.execute(stmt)
    projects = [ProjectResponse.model_validate(p) for p in res.scalars().all()]

    return PaginatedResponse(
        data=projects,
        pagination=PaginationMeta(page=page, page_size=page_size, total_items=total_items, total_pages=total_pages),
    )


@router.get("/projects/{project_id}", response_model=APIResponse[ProjectResponse])
async def get_project(project: Project = Depends(get_project_for_user)):
    return APIResponse(message="Project retrieved successfully", data=ProjectResponse.model_validate(project))


@router.patch("/projects/{project_id}", response_model=APIResponse[ProjectResponse])
async def update_project(
    payload: ProjectUpdate,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    if payload.status is not None:
        project.status = payload.status
    await db.commit()
    await db.refresh(project)
    return APIResponse(message="Project updated successfully", data=ProjectResponse.model_validate(project))


@router.delete("/projects/{project_id}", response_model=APIResponse[dict])
async def delete_project(project: Project = Depends(get_project_for_user), db: AsyncSession = Depends(get_db)):
    await db.delete(project)
    await db.commit()
    return APIResponse(message="Project deleted successfully", data={"deleted_id": str(project.id)})


# --- Sessions & Messages ---

@router.post("/projects/{project_id}/sessions", response_model=APIResponse[SessionResponse], status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: SessionCreate,
    project: Project = Depends(get_project_for_user),
    db: AsyncSession = Depends(get_db),
):
    session = Session(project_id=project.id, name=payload.name, session_type=payload.session_type)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return APIResponse(message="Session created successfully", data=SessionResponse.model_validate(session))


@router.get("/projects/{project_id}/sessions", response_model=APIResponse[list[SessionResponse]])
async def list_sessions(project: Project = Depends(get_project_for_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Session).where(Session.project_id == project.id).order_by(Session.created_at.desc()))
    sessions = [SessionResponse.model_validate(s) for s in res.scalars().all()]
    return APIResponse(message="Sessions retrieved", data=sessions)


async def _get_owned_session(session_id: uuid.UUID, db: AsyncSession, current_user: User) -> Session:
    stmt = (
        select(Session)
        .join(Project, Session.project_id == Project.id)
        .where(Session.id == session_id, Project.owner_id == current_user.id)
    )
    res = await db.execute(stmt)
    session = res.scalars().first()
    if not session:
        raise NotFoundException("Session not found or access denied.")
    return session


@router.get("/sessions/{session_id}", response_model=APIResponse[SessionResponse])
async def get_session(
    session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    session = await _get_owned_session(session_id, db, current_user)
    return APIResponse(message="Session retrieved", data=SessionResponse.model_validate(session))


@router.post("/sessions/{session_id}/messages", response_model=APIResponse[MessageResponse], status_code=status.HTTP_201_CREATED)
async def add_message(
    session_id: uuid.UUID,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_owned_session(session_id, db, current_user)
    count_res = await db.execute(select(func.count(Message.id)).where(Message.session_id == session.id))
    next_seq = (count_res.scalar() or 0) + 1

    msg = Message(
        session_id=session.id,
        sequence_number=next_seq,
        role=payload.role,
        content=payload.content,
        metadata_=payload.metadata,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return APIResponse(message="Message recorded", data=MessageResponse.model_validate(msg))


@router.get("/sessions/{session_id}/messages", response_model=APIResponse[list[MessageResponse]])
async def list_messages(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await _get_owned_session(session_id, db, current_user)
    res = await db.execute(
        select(Message).where(Message.session_id == session.id).order_by(Message.sequence_number.asc())
    )
    msgs = [MessageResponse.model_validate(m) for m in res.scalars().all()]
    return APIResponse(message="Messages retrieved", data=msgs)