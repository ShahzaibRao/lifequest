"""Weekly insights endpoint (LLD Section 2.6) - rule-based only, no LLM."""

import statistics
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.health_log import HealthLog
from app.models.session import WalkingSession
from app.models.territory import HexOwnership, XpLedger
from app.models.user import User
from pydantic import BaseModel
from app.schemas.insights import DailyInsights, DailySteps, LateDinnerNote, WeeklyInsights
from app.services.evaluation import PKT, _as_aware, _week_start_pk

router = APIRouter(prefix="/insights", tags=["insights"])

DISCLAIMER = "These are patterns in your own logs, not medical advice or a diagnosis."


def _pkt_date(value: datetime) -> object:
    return _as_aware(value).astimezone(PKT).date()


def _sleep_per_day(logs) -> dict:
    per_day: dict = {}
    for log in logs:
        if log.kind != "sleep":
            continue
        minutes = log.payload.get("minutes")
        if isinstance(minutes, int) and not isinstance(minutes, bool):
            per_day[log.logged_date] = per_day.get(log.logged_date, 0) + minutes
    return per_day


def _mean(values) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 1)


@router.get("/daily", response_model=DailyInsights)
def daily_insights(date: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """One day's summary (PKT date, YYYY-MM-DD)."""
    from datetime import date as _date

    try:
        day = _date.fromisoformat(date)
    except ValueError:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    sessions = db.query(WalkingSession).filter(WalkingSession.user_id == current_user.id).all()
    day_sessions = [sess for sess in sessions if _pkt_date(sess.started_at) == day]
    steps = sum((sess.total_steps or 0) for sess in day_sessions if sess.total_steps is not None) or None
    valid_m = round(sum((sess.total_distance_m or 0) for sess in day_sessions if sess.status == "evaluated"), 1)
    xp_rows = db.query(XpLedger).filter(XpLedger.user_id == current_user.id).all()
    xp = sum(row.xp for row in xp_rows if _pkt_date(row.created_at) == day)
    return DailyInsights(date=day, steps=steps, valid_m=valid_m, sessions=len(day_sessions), xp=xp)


class MonthRecords(BaseModel):
    days: list[DailyInsights]


@router.get("/records", response_model=MonthRecords)
def month_records(year: int, month: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every day of the given month with any walking session, newest first."""
    import calendar as _cal

    if not (1 <= month <= 12):
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="month must be 1-12")
    from datetime import date as _date

    days_in_month = _cal.monthrange(year, month)[1]
    sessions = db.query(WalkingSession).filter(WalkingSession.user_id == current_user.id).all()
    xp_rows = db.query(XpLedger).filter(XpLedger.user_id == current_user.id).all()
    by_day: dict = {}
    for sess in sessions:
        day = _pkt_date(sess.started_at)
        if day.year != year or day.month != month:
            continue
        rec = by_day.setdefault(day, {"steps": 0, "has_steps": False, "valid_m": 0.0, "sessions": 0, "xp": 0})
        if sess.total_steps is not None:
            rec["steps"] += sess.total_steps
            rec["has_steps"] = True
        if sess.status == "evaluated":
            rec["valid_m"] += sess.total_distance_m or 0
        rec["sessions"] += 1
    for row in xp_rows:
        day = _pkt_date(row.created_at)
        if day in by_day:
            by_day[day]["xp"] += row.xp
    out = [
        DailyInsights(
            date=day,
            steps=(rec["steps"] if rec["has_steps"] else None),
            valid_m=round(rec["valid_m"], 1),
            sessions=rec["sessions"],
            xp=rec["xp"],
        )
        for day, rec in sorted(by_day.items(), reverse=True)
    ]
    return MonthRecords(days=out)


@router.get("/weekly", response_model=WeeklyInsights)
def weekly_insights(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    week_start = _week_start_pk(now)
    prev_week_start = week_start - timedelta(days=7)
    logs = db.query(HealthLog).filter(HealthLog.user_id == current_user.id, HealthLog.logged_date >= prev_week_start, HealthLog.logged_date <= week_start + timedelta(days=6)).all()
    sleep_by_day = _sleep_per_day(logs)
    this_sleep = [m for d, m in sleep_by_day.items() if week_start <= d <= week_start + timedelta(days=6)]
    prev_sleep = [m for d, m in sleep_by_day.items() if prev_week_start <= d < week_start]
    sleep_avg = _mean(this_sleep)
    prev_avg = _mean(prev_sleep)
    sleep_vs_prev = round(sleep_avg - prev_avg, 1) if sleep_avg is not None and prev_avg is not None else None
    sessions = db.query(WalkingSession).filter(WalkingSession.user_id == current_user.id).all()
    steps_by_day: dict = {}
    valid_m_by_day: dict = {}
    session_days = set()
    evaluated_this_week = []
    for session in sessions:
        day = _pkt_date(session.started_at)
        session_days.add(day)
        if week_start <= day <= week_start + timedelta(days=6):
            if session.total_steps is not None:
                steps_by_day[day] = steps_by_day.get(day, 0) + session.total_steps
            if session.status == "evaluated":
                evaluated_this_week.append(session)
                valid_m_by_day[day] = valid_m_by_day.get(day, 0) + (session.total_distance_m or 0)
    steps_avg = _mean(list(steps_by_day.values()))
    daily_steps = [
        DailySteps(
            date=week_start + timedelta(days=i),
            steps=steps_by_day.get(week_start + timedelta(days=i)),
            valid_m=round(valid_m_by_day.get(week_start + timedelta(days=i), 0), 1),
        )
        for i in range(7)
    ]
    log_days = {log.logged_date for log in logs if week_start <= log.logged_date <= week_start + timedelta(days=6)}
    logging_days = len(log_days | {d for d in session_days if week_start <= d <= week_start + timedelta(days=6)})
    late_days = []
    for log in logs:
        if log.kind != "meal" or log.payload.get("meal_type") != "dinner":
            continue
        if _as_aware(log.created_at).astimezone(PKT).hour < 21:
            continue
        if log.logged_date in sleep_by_day:
            late_days.append(sleep_by_day[log.logged_date])
    last_7_sleep = [m for d, m in sorted(sleep_by_day.items(), reverse=True)[:7]]
    if len(late_days) >= 3 and last_7_sleep:
        median_sleep = statistics.median(last_7_sleep)
        difference = round(sum(late_days) / len(late_days) - median_sleep, 1)
        late_note = LateDinnerNote(confidence="pattern", status="reported", late_dinner_days=len(late_days), difference_minutes=difference, note=f"On {len(late_days)} late-dinner days, sleep averaged {difference:+.1f} minutes versus your 7-day median. This is a possible pattern, not proof that dinner caused it.")
    else:
        late_note = LateDinnerNote(confidence="pattern", status="insufficient_data", late_dinner_days=len(late_days), difference_minutes=None, note="Need at least 3 late-dinner days with sleep logs to compare.")
    total_valid = sum((s.total_distance_m or 0) for s in evaluated_this_week)
    live_territories = db.query(HexOwnership).filter(HexOwnership.owner_id == current_user.id, HexOwnership.superseded_at.is_(None)).all()
    live_count = sum(1 for row in live_territories if _as_aware(row.expires_at) > now)
    activity_summary = f"{len(evaluated_this_week)} walking sessions this week, {total_valid:.0f} m valid walk, {live_count} territories held."
    return WeeklyInsights(week_start=week_start, sleep_avg_minutes=sleep_avg, sleep_vs_prev_week_minutes=sleep_vs_prev, steps_avg_per_day=steps_avg, logging_days=logging_days, late_dinner_sleep_note=late_note, activity_summary=activity_summary, confidence="pattern", disclaimer=DISCLAIMER, daily_steps=daily_steps)
