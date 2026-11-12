"""FriendChallenge ORM (P2 social).

Migration 003 is the source of truth for the schema; this model never
creates tables (same rule as the migration-001 models).

Statuses: pending (awaiting accept, 24h to answer) -> active (race on)
-> completed (winner_id set, NULL = draw). Terminal rows are KEPT:
declined/expired/completed are history, unlike friendships where
reject/cancel/unfriend delete the row.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class FriendChallenge(Base):
    __tablename__ = "friend_challenges"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    challenger_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    opponent_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    target_m: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    # pending | active | completed | declined | expired
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    winner_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    challenger_distance_m: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    opponent_distance_m: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deadline_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
