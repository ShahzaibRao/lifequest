"""Walking session and session point ORM models (LLD Sections 1.3, 1.4)."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class WalkingSession(Base):
    __tablename__ = "walking_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    activity_mode: Mapped[str] = mapped_column(Text, nullable=False, default="walk")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="uploading")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_steps: Mapped[int | None] = mapped_column(nullable=True)
    total_distance_m: Mapped[float | None] = mapped_column(nullable=True)
    evaluation_result: Mapped[dict | None] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SessionPoint(Base):
    __tablename__ = "session_points"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer(), "sqlite"), primary_key=True, autoincrement=True)
    session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("walking_sessions.session_uuid"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)
    latitude: Mapped[float] = mapped_column(nullable=False)
    longitude: Mapped[float] = mapped_column(nullable=False)
    accuracy_m: Mapped[float | None] = mapped_column(nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
