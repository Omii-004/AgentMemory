from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.core.exceptions import ConflictException, UnauthorizedException
from app.core.security import create_access_token, get_password_hash, verify_password
from app.database.connection import get_db
from app.database.models.user import User
from app.schemas.auth import TokenResponse, UserLoginRequest, UserRegisterRequest, UserResponse
from app.schemas.common import APIResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=APIResponse[UserResponse], status_code=status.HTTP_201_CREATED)
async def register_user(payload: UserRegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalars().first():
        raise ConflictException("An account with this email already exists.")

    user = User(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        display_name=payload.display_name or payload.email.split("@")[0],
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return APIResponse(message="User registered successfully", data=UserResponse.model_validate(user))


@router.post("/login", response_model=APIResponse[TokenResponse])
async def login(payload: UserLoginRequest, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalars().first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise UnauthorizedException("Incorrect email or password.")

    token = create_access_token(subject=str(user.id))
    return APIResponse(
        message="Login successful",
        data=TokenResponse(access_token=token, user=UserResponse.model_validate(user)),
    )


@router.post("/token", response_model=TokenResponse, include_in_schema=False)
async def login_swagger_oauth2(
    form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)
):
    """Compatibility route for Swagger UI's OAuth2 Authorize dialog."""
    res = await db.execute(select(User).where(User.email == form_data.username))
    user = res.scalars().first()
    if not user or not user.password_hash or not verify_password(form_data.password, user.password_hash):
        raise UnauthorizedException("Incorrect email or password.")

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


@router.get("/me", response_model=APIResponse[UserResponse])
async def get_me(current_user: User = Depends(get_current_user)):
    return APIResponse(message="Current user retrieved", data=UserResponse.model_validate(current_user))


@router.post("/logout", response_model=APIResponse[dict])
async def logout(current_user: User = Depends(get_current_user)):
    return APIResponse(message="Logged out successfully", data={"logged_out": True})