import uuid

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.core.security import decode_access_token
from app.database.connection import get_db
from app.database.models.user import Project, User

# OAuth2 scheme extracting Bearer tokens from the Authorization header
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False
)


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    token: str | None = Depends(oauth2_scheme)
) -> User:
    """Validates JWT token and retrieves the authenticated User record."""
    if not token:
        raise UnauthorizedException("Authentication token is missing.")

    payload = decode_access_token(token)
    user_id_str: str | None = payload.get("sub")
    if not user_id_str:
        raise UnauthorizedException("Invalid authentication credentials.")

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise UnauthorizedException("Invalid token user identifier.")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalars().first()

    if not user:
        raise UnauthorizedException("User no longer exists.")
    if not user.is_active:
        raise ForbiddenException("User account is inactive.")

    return user


async def get_project_for_user(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Project:
    """Enforces multi-tenant project isolation: verifies project exists and belongs to current user."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == current_user.id
        )
    )
    project = result.scalars().first()

    if not project:
        raise NotFoundException("Project not found or access denied.")

    return project