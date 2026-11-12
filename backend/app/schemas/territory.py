"""Territory map / my-territories / leaderboard shapes (LLD 2.4, 2.5)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class TerritoryMapItem(BaseModel):
    h3_index: str
    owner_display_name: str
    owner_user_id: str
    avatar_key: str | None = None
    is_mine: bool
    hex_score_m: float
    expires_at: datetime
    locked_until: datetime
    boundary: list[list[float]]


class TerritoryMeItem(BaseModel):
    h3_index: str
    hex_score_m: float
    expires_at: datetime
    locked_until: datetime
    seconds_remaining: int


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: uuid.UUID
    display_name: str
    xp: int
    is_me: bool
    avatar_key: str | None = None
    city: str | None = None


class WeeklyLeaderboard(BaseModel):
    week_start: date
    entries: list[LeaderboardEntry]


class LeaderboardResponse(BaseModel):
    period: str
    period_start: date
    entries: list[LeaderboardEntry]
    me_rank: int | None = None
    me_xp: int = 0
    total_xp: int = 0
    level: int = 1
    month_xp: int = 0
    best_week_xp: int = 0
    last_week_xp: int = 0
