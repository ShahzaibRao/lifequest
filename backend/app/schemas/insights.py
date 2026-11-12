"""Weekly insights shapes (LLD Section 2.6, rule-based only)."""

from datetime import date

from pydantic import BaseModel


class LateDinnerNote(BaseModel):
    confidence: str
    status: str
    late_dinner_days: int
    difference_minutes: int | None
    note: str


class DailySteps(BaseModel):
    date: date
    steps: int | None
    valid_m: float


class DailyInsights(BaseModel):
    date: date
    steps: int | None
    valid_m: float
    sessions: int
    xp: int


class WeeklyInsights(BaseModel):
    week_start: date
    sleep_avg_minutes: float | None
    sleep_vs_prev_week_minutes: float | None
    steps_avg_per_day: float | None
    logging_days: int
    late_dinner_sleep_note: LateDinnerNote
    activity_summary: str
    confidence: str
    disclaimer: str
    daily_steps: list[DailySteps]
