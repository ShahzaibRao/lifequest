"""Weekly leaderboard endpoint (LLD Section 2.5)."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.territory import XpLedger
from app.models.user import User
from app.schemas.territory import LeaderboardEntry, LeaderboardResponse, WeeklyLeaderboard
from app.services.evaluation import PKT, _week_start_pk

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("/weekly", response_model=WeeklyLeaderboard)
def weekly_leaderboard(week_start: date | None = Query(default=None), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if week_start is None:
        week_start = _week_start_pk(datetime.now(timezone.utc))
    rows = db.query(XpLedger.user_id, func.sum(XpLedger.xp).label("total_xp")).filter(XpLedger.week_start == week_start).group_by(XpLedger.user_id).order_by(func.sum(XpLedger.xp).desc(), XpLedger.user_id.asc()).limit(100).all()
    user_ids = [row.user_id for row in rows]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    entries = []
    for i, row in enumerate(rows):
        u = users.get(row.user_id)
        entries.append(LeaderboardEntry(rank=i + 1, user_id=row.user_id, display_name=u.display_name if u else "unknown", xp=int(row.total_xp), is_me=row.user_id == current_user.id, avatar_key=u.avatar_key if u else None, city=u.city if u else None))
    return WeeklyLeaderboard(week_start=week_start, entries=entries)


PERIODS = ("daily", "weekly", "monthly", "quarterly", "yearly", "all")


def _pkt_day_start_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=PKT).astimezone(timezone.utc)


def _period_bounds(period: str, now: datetime) -> tuple[date, datetime | None]:
    """(period_start_date, created_at lower bound in UTC).
    weekly uses the week_start column instead (bound None). all has no bound."""
    local = now.astimezone(PKT).date()
    if period == "daily":
        return local, _pkt_day_start_utc(local)
    if period == "weekly":
        return local - timedelta(days=local.weekday()), None
    if period == "monthly":
        first = local.replace(day=1)
        return first, _pkt_day_start_utc(first)
    if period == "quarterly":
        qm = ((local.month - 1) // 3) * 3 + 1
        first = local.replace(month=qm, day=1)
        return first, _pkt_day_start_utc(first)
    if period == "yearly":
        first = local.replace(month=1, day=1)
        return first, _pkt_day_start_utc(first)
    return local, None


def _me_stats(db: Session, user_id, now: datetime) -> dict:
    total = int(db.query(func.sum(XpLedger.xp)).filter(XpLedger.user_id == user_id).scalar() or 0)
    _, month_since = _period_bounds("monthly", now)
    month_xp = int(db.query(func.sum(XpLedger.xp)).filter(XpLedger.user_id == user_id, XpLedger.created_at >= month_since).scalar() or 0)
    week_sums = db.query(func.sum(XpLedger.xp)).filter(XpLedger.user_id == user_id).group_by(XpLedger.week_start).all()
    best_week = max((int(r[0]) for r in week_sums), default=0)
    last_ws = _week_start_pk(now) - timedelta(days=7)
    last_week = int(db.query(func.sum(XpLedger.xp)).filter(XpLedger.user_id == user_id, XpLedger.week_start == last_ws).scalar() or 0)
    return {"total_xp": total, "level": total // 100 + 1, "month_xp": month_xp, "best_week_xp": best_week, "last_week_xp": last_week}


@router.get("", response_model=LeaderboardResponse)
def leaderboard(period: str = Query(default="weekly"), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if period not in PERIODS:
        period = "weekly"
    now = datetime.now(timezone.utc)
    period_start, since = _period_bounds(period, now)
    q = db.query(XpLedger.user_id, func.sum(XpLedger.xp).label("total_xp"))
    if period == "weekly":
        q = q.filter(XpLedger.week_start == period_start)
    elif since is not None:
        q = q.filter(XpLedger.created_at >= since)
    rows = q.group_by(XpLedger.user_id).order_by(func.sum(XpLedger.xp).desc(), XpLedger.user_id.asc()).limit(100).all()
    user_ids = [row.user_id for row in rows]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    entries = []
    for i, row in enumerate(rows):
        u = users.get(row.user_id)
        entries.append(LeaderboardEntry(rank=i + 1, user_id=row.user_id, display_name=u.display_name if u else "unknown", xp=int(row.total_xp), is_me=row.user_id == current_user.id, avatar_key=u.avatar_key if u else None, city=u.city if u else None))
    me_rank = next((i + 1 for i, row in enumerate(rows) if row.user_id == current_user.id), None)
    me_xp = next((int(row.total_xp) for row in rows if row.user_id == current_user.id), 0)
    stats = _me_stats(db, current_user.id, now)
    return LeaderboardResponse(period=period, period_start=period_start, entries=entries, me_rank=me_rank, me_xp=me_xp, **stats)
