"""Friend-challenge shapes (P2 social, locked rules 2026-11-04)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class ChallengeCreate(BaseModel):
    opponent_id: uuid.UUID
    # Locked targets: 1 / 3 / 5 km. Anything else is a 422.
    target_m: int
    # Locked durations: 1 / 3 / 7 days. Anything else is a 422.
    duration_days: int


class ChallengeItem(BaseModel):
    challenge_id: uuid.UUID
    challenger_id: uuid.UUID
    opponent_id: uuid.UUID
    challenger_display_name: str
    opponent_display_name: str
    target_m: int
    duration_days: int
    # pending | active | completed | declined | expired
    status: str
    # NULL on completed = draw (no bonus).
    winner_id: uuid.UUID | None = None
    challenger_distance_m: float
    opponent_distance_m: float
    expires_at: datetime
    accepted_at: datetime | None = None
    deadline_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
