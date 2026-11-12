"""Walking session request/response shapes (LLD Section 2.3)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SessionStartCreate(BaseModel):
    session_uuid: uuid.UUID
    activity_mode: Literal["walk"] = "walk"
    started_at: datetime


class PointCreate(BaseModel):
    seq: int = Field(ge=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    recorded_at: datetime


class ChunkCreate(BaseModel):
    seq_start: int = Field(ge=1)
    seq_end: int = Field(ge=1)
    points: list[PointCreate] = Field(min_length=1, max_length=500)
    is_final: bool = False
    total_steps: int | None = Field(default=None, ge=0)


class SessionResponse(BaseModel):
    session_uuid: uuid.UUID
    activity_mode: str
    status: str
    started_at: datetime
    ended_at: datetime | None
    total_steps: int | None
    total_distance_m: float | None
    evaluation_result: dict | None
    last_uploaded_seq: int
    points_count: int
