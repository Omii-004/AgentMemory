import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.database.models.user import Project


class Session(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "sessions"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    session_type: Mapped[str] = mapped_column(String(50), default="conversation", nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="sessions")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="session", cascade="all, delete-orphan", order_by="Message.sequence_number")


class Message(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "messages"

    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False)  # user, assistant, system, tool
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="messages")