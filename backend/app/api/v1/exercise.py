"""Manual exercise entries (B7).

POST /exercise — log one exercise (type + minutes). Calories are
estimated server-side (kcal/min by type). GET /exercise lists recent
entries, newest first (optional ?date=YYYY-MM-DD filter).
"""

from datetime import date as _date
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.exercise import ExerciseLog
from app.models.user import User
from app.services.evaluation import PKT, _as_aware

router = APIRouter(prefix="/exercise", tags=["exercise"])

# Rough kcal per minute by type (moderate effort).
KCAL_PER_MIN = {
    "running": 10,
    "cycling": 8,
    "gym": 6,
    "swimming": 9,
    "walking": 4,
    "other": 5,
}


class ExerciseCreate(BaseModel):
    exercise_type: str
    duration_minutes: int
    logged_date: _date | None = None


class ExerciseOut(BaseModel):
    id: str
    exercise_type: str
    duration_minutes: int
    calories: int
    logged_date: _date


@router.post("", response_model=ExerciseOut)
def create_exercise(payload: ExerciseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.duration_minutes <= 0:
        raise HTTPException(status_code=422, detail="duration must be positive")
    etype = payload.exercise_type.strip().lower() or "other"
    kcal = KCAL_PER_MIN.get(etype, KCAL_PER_MIN["other"]) * payload.duration_minutes
    day = payload.logged_date or _as_aware(datetime.now(timezone.utc)).astimezone(PKT).date()
    row = ExerciseLog(
        user_id=current_user.id,
        exercise_type=etype,
        duration_minutes=payload.duration_minutes,
        calories=kcal,
        logged_date=day,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ExerciseOut(
        id=str(row.id),
        exercise_type=row.exercise_type,
        duration_minutes=row.duration_minutes,
        calories=row.calories,
        logged_date=row.logged_date,
    )


@router.get("", response_model=list[ExerciseOut])
def list_exercises(date: str | None = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(ExerciseLog).filter(ExerciseLog.user_id == current_user.id)
    if date:
        try:
            day = _date.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
        q = q.filter(ExerciseLog.logged_date == day)
    rows = q.order_by(ExerciseLog.logged_date.desc(), ExerciseLog.created_at.desc()).limit(50).all()
    return [
        ExerciseOut(
            id=str(r.id),
            exercise_type=r.exercise_type,
            duration_minutes=r.duration_minutes,
            calories=r.calories,
            logged_date=r.logged_date,
        )
        for r in rows
    ]
