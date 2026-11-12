"""Achievement endpoints (XP levels + Achievements, locked 2026-11-05).

One read endpoint: it evaluates every definition, awards newly-earned
milestones, and returns the level + full achievement list. Awarding is
lazy on read (same pattern as challenge finalization).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.achievement import AchievementsResponse
from app.services.achievements import get_achievements

router = APIRouter(prefix="/achievements", tags=["achievements"])


@router.get("", response_model=AchievementsResponse)
def list_achievements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = get_achievements(db, current_user.id)
    if state["changed"]:
        db.commit()
    state.pop("changed")
    return state
