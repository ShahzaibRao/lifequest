"""Health log request/response shapes (LLD Sections 1.2 and 2.2)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class HealthLogCreate(BaseModel):
    kind: Literal["meal", "water", "sleep", "exercise"]
    logged_date: date
    payload: dict
    client_uuid: uuid.UUID


class HealthLogResponse(BaseModel):
    id: uuid.UUID
    kind: str
    logged_date: date
    payload: dict
    client_uuid: uuid.UUID
    created_at: datetime


class DailySummary(BaseModel):
    logged_date: date
    logs_count: int
    meals_count: int
    total_calories: int | None
    water_ml: int
    sleep_minutes: int
    exercise_minutes: int
