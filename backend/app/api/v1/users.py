"""Public profile + avatar presets (Profile feature, 2026-11-05).

Privacy: a public profile shows shared fields (name, city, bio,
avatar) + game stats only. Steps, health logs, email are never
exposed here — same rule as the friends endpoints.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.achievement import UserAchievement
from app.models.territory import HexOwnership, XpLedger
from app.models.user import User, UserTarget
from pydantic import BaseModel
from app.schemas.profile import (
    AVATAR_PRESETS,
    AvatarPreset,
    PublicProfileResponse,
)
from app.services.achievements import level_for
from app.services.evaluation import _week_start_pk

router = APIRouter(prefix="/users", tags=["users"])


class UserTargets(BaseModel):
    daily_steps_target: int = 10000
    weekly_distance_km_target: float = 7.0


@router.get("/me/targets", response_model=UserTargets)
def get_my_targets(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(UserTarget).filter(UserTarget.user_id == current_user.id).first()
    if row is None:
        return UserTargets()
    return UserTargets(
        daily_steps_target=row.daily_steps_target,
        weekly_distance_km_target=float(row.weekly_distance_km_target),
    )


@router.put("/me/targets", response_model=UserTargets)
def put_my_targets(payload: UserTargets, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.daily_steps_target <= 0 or payload.weekly_distance_km_target <= 0:
        raise HTTPException(status_code=422, detail="targets must be positive")
    row = db.query(UserTarget).filter(UserTarget.user_id == current_user.id).first()
    if row is None:
        row = UserTarget(user_id=current_user.id)
        db.add(row)
    row.daily_steps_target = payload.daily_steps_target
    row.weekly_distance_km_target = payload.weekly_distance_km_target
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return UserTargets(
        daily_steps_target=row.daily_steps_target,
        weekly_distance_km_target=float(row.weekly_distance_km_target),
    )


@router.get("/avatar-presets", response_model=list[AvatarPreset])
def list_avatar_presets(current_user: User = Depends(get_current_user)):
    return [AvatarPreset(**preset) for preset in AVATAR_PRESETS]


@router.get("/{user_id}/profile", response_model=PublicProfileResponse)
def get_public_profile(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    week_start = _week_start_pk(datetime.now(timezone.utc))
    total_xp = (
        db.query(func.coalesce(func.sum(XpLedger.xp), 0))
        .filter(XpLedger.user_id == user_id)
        .scalar()
        or 0
    )
    weekly_rows = (
        db.query(XpLedger.user_id, func.sum(XpLedger.xp).label("week_xp"))
        .filter(XpLedger.week_start == week_start)
        .group_by(XpLedger.user_id)
        .all()
    )
    weekly_by_user = {row.user_id: int(row.week_xp) for row in weekly_rows}
    weekly_xp = weekly_by_user.get(user_id, 0)
    weekly_rank = 1 + sum(1 for xp in weekly_by_user.values() if xp > weekly_xp)
    territories_count = (
        db.query(func.count(HexOwnership.h3_index))
        .filter(
            HexOwnership.owner_id == user_id,
            HexOwnership.superseded_at.is_(None),
        )
        .scalar()
        or 0
    )
    achievements_count = (
        db.query(func.count(UserAchievement.id))
        .filter(UserAchievement.user_id == user_id)
        .scalar()
        or 0
    )
    return PublicProfileResponse(
        user_id=user.id,
        display_name=user.display_name,
        city=user.city,
        bio=user.bio,
        avatar_key=user.avatar_key,
        level=level_for(int(total_xp))[0],
        total_xp=int(total_xp),
        territories_count=int(territories_count),
        weekly_xp=weekly_xp,
        weekly_rank=weekly_rank,
        achievements_count=int(achievements_count),
    )
