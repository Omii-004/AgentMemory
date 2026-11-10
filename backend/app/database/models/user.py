import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.database.models.benchmark import BenchmarkDataset
    from app.database.models.conversation import Session
    from app.database.models.evaluation import Report
    from app.database.models.experiment import Experiment
    from app.database.models.memory import MemoryNamespace


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    projects: Mapped[list["Project"]] = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "projects"

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)

    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="projects")
    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="project", cascade="all, delete-orphan")
    memory_namespaces: Mapped[list["MemoryNamespace"]] = relationship("MemoryNamespace", back_populates="project", cascade="all, delete-orphan")
    benchmark_datasets: Mapped[list["BenchmarkDataset"]] = relationship("BenchmarkDataset", back_populates="project", cascade="all, delete-orphan")
    experiments: Mapped[list["Experiment"]] = relationship("Experiment", back_populates="project", cascade="all, delete-orphan")
    reports: Mapped[list["Report"]] = relationship("Report", back_populates="project", cascade="all, delete-orphan")