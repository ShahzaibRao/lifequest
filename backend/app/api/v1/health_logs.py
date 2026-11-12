"""Health log endpoints (LLD Section 2.2)."""

import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.health_log import HealthLog
from app.models.user import User
from app.schemas.health_log import DailySummary, HealthLogCreate, HealthLogResponse

router = APIRouter(prefix="/health-logs", tags=["health-logs"])

_MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _invalid(message: str):
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_payload(kind: str, payload: dict) -> None:
    if not isinstance(payload, dict):
        _invalid("payload must be an object")
    if kind == "meal":
        if payload.get("meal_type") not in _MEAL_TYPES:
            _invalid("meal.payload.meal_type must be breakfast, lunch, dinner or snack")
        if "calories" in payload and payload["calories"] is not None:
            if not _is_int(payload["calories"]) or payload["calories"] < 0:
                _invalid("meal.payload.calories must be a non-negative integer or omitted")
        if "note" in payload and payload["note"] is not None and not isinstance(payload["note"], str):
            _invalid("meal.payload.note must be a string or omitted")
    elif kind == "water":
        if not _is_int(payload.get("millilitres")) or payload["millilitres"] <= 0:
            _invalid("water.payload.millilitres must be a positive integer")
    elif kind == "sleep":
        if not _is_int(payload.get("minutes")) or payload["minutes"] <= 0:
            _invalid("sleep.payload.minutes must be a positive integer")
        for key in ("bedtime", "wake_time"):
            if key in payload and payload[key] is not None:
                if not isinstance(payload[key], str) or not _TIME_RE.match(payload[key]):
                    _invalid(f"sleep.payload.{key} must be HH:MM or omitted")
    elif kind == "exercise":
        if not isinstance(payload.get("kind"), str) or not payload["kind"].strip():
            _invalid("exercise.payload.kind must be a non-empty string")
        if not _is_int(payload.get("minutes")) or payload["minutes"] <= 0:
            _invalid("exercise.payload.minutes must be a positive integer")


def _to_response(log: HealthLog) -> HealthLogResponse:
    return HealthLogResponse(id=log.id, kind=log.kind, logged_date=log.logged_date, payload=log.payload, client_uuid=log.client_uuid, created_at=log.created_at)


@router.post("", response_model=HealthLogResponse, status_code=201)
def create_health_log(payload: HealthLogCreate, response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    validate_payload(payload.kind, payload.payload)
    existing = db.query(HealthLog).filter(HealthLog.user_id == current_user.id, HealthLog.client_uuid == payload.client_uuid).first()
    if existing is not None:
        response.status_code = 200
        return _to_response(existing)
    log = HealthLog(user_id=current_user.id, kind=payload.kind, logged_date=payload.logged_date, payload=payload.payload, client_uuid=payload.client_uuid)
    db.add(log)
    db.commit()
    db.refresh(log)
    return _to_response(log)


@router.get("/summary", response_model=list[DailySummary])
def health_summary(from_date: date | None = Query(default=None, alias="from"), to_date: date | None = Query(default=None, alias="to"), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    if to_date is None:
        to_date = today
    if from_date is None:
        from_date = to_date - timedelta(days=6)
    if from_date > to_date:
        _invalid("from must not be after to")
    logs = db.query(HealthLog).filter(HealthLog.user_id == current_user.id, HealthLog.logged_date >= from_date, HealthLog.logged_date <= to_date).order_by(HealthLog.logged_date, HealthLog.created_at).all()
    by_date: dict[date, dict] = {}
    for log in logs:
        bucket = by_date.setdefault(log.logged_date, {"logs_count": 0, "meals_count": 0, "calories": [], "water_ml": 0, "sleep_minutes": 0, "exercise_minutes": 0})
        bucket["logs_count"] += 1
        if log.kind == "meal":
            bucket["meals_count"] += 1
            calories = log.payload.get("calories")
            if _is_int(calories):
                bucket["calories"].append(calories)
        elif log.kind == "water":
            bucket["water_ml"] += log.payload.get("millilitres", 0)
        elif log.kind == "sleep":
            bucket["sleep_minutes"] += log.payload.get("minutes", 0)
        elif log.kind == "exercise":
            bucket["exercise_minutes"] += log.payload.get("minutes", 0)
    return [DailySummary(logged_date=day, logs_count=b["logs_count"], meals_count=b["meals_count"], total_calories=sum(b["calories"]) if b["calories"] else None, water_ml=b["water_ml"], sleep_minutes=b["sleep_minutes"], exercise_minutes=b["exercise_minutes"]) for day, b in sorted(by_date.items())]


@router.get("", response_model=list[HealthLogResponse])
def list_health_logs(log_date: date | None = Query(default=None, alias="date"), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if log_date is None:
        log_date = date.today()
    logs = db.query(HealthLog).filter(HealthLog.user_id == current_user.id, HealthLog.logged_date == log_date).order_by(HealthLog.created_at).all()
    return [_to_response(log) for log in logs]
