"""Territory, XP, flag and job models (LLD Sections 1.5-1.8, 6)."""

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class SessionHexDistance(Base):
    __tablename__ = "session_hex_distances"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("walking_sessions.session_uuid"), nullable=False)
    h3_index: Mapped[int] = mapped_column(BigInteger, nullable=False)
    valid_distance_m: Mapped[float] = mapped_column(nullable=False)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)


class HexOwnership(Base):
    __tablename__ = "hex_ownership"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    h3_index: Mapped[int] = mapped_column(BigInteger, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    hex_score_m: Mapped[float] = mapped_column(nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("walking_sessions.session_uuid"), nullable=False)
    centre_lat: Mapped[float] = mapped_column(nullable=False)
    centre_lon: Mapped[float] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class XpLedger(Base):
    __tablename__ = "xp_ledger"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    entry_type: Mapped[str] = mapped_column(Text, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False)
    week_start: Mapped[date] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class FlaggedSession(Base):
    __tablename__ = "flagged_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("walking_sessions.session_uuid"), unique=True, nullable=False)
    reasons: Mapped[dict] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=False)
    review_status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    job_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=dict)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
