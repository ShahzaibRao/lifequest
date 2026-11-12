"""Level + achievement rules (XP levels + Achievements, locked 2026-11-05).

Levels come from LIFETIME xp_ledger totals (weekly resets never demote):
  Level = total_xp // 100 + 1, progress = total_xp % 100.
Achievements are earned milestones, awarded once, never revoked.
Awarding is lazy on read (same pattern as challenge finalization):
GET /achievements evaluates every definition and inserts rows for
newly-earned milestones, so old milestones unlock retroactively on
first read.

Definition sources (all existing tables, no new tracking):
- first_walk: any evaluated session.
- first_capture: any hex_ownership row ever (live or superseded).
- first_challenge_win: a 'bonus' xp_ledger row worth exactly 100 XP.
  The territory-challenge bonus is the only 100-XP bonus
  (capture +50, friend challenge +50, walk XP has entry_type 'walk'),
  so amount + type together identify it.
- first_friend_win: a completed friend challenge with winner_id = user.
- collector_5: 5+ live territories (superseded_at IS NULL).
- walker_10km / walker_50km: lifetime valid walk distance
  (SUM of total_distance_m over evaluated sessions).
- rival_5: 5+ completed friend challenges won.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.achievement import UserAchievement
from app.models.challenge import FriendChallenge
from app.models.session import WalkingSession
from app.models.territory import HexOwnership, XpLedger

XP_PER_LEVEL = 100


def level_for(total_xp: int) -> tuple[int, int, int]:
    """Return (level, xp_progress, xp_to_next) for a lifetime XP total."""
    level = total_xp // XP_PER_LEVEL + 1
    progress = total_xp % XP_PER_LEVEL
    return level, progress, XP_PER_LEVEL - progress


def _has_evaluated_walk(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(WalkingSession.id)
        .filter(
            WalkingSession.user_id == user_id,
            WalkingSession.status == "evaluated",
        )
        .first()
        is not None
    )


def _has_ever_captured(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(HexOwnership.h3_index)
        .filter(HexOwnership.owner_id == user_id)
        .first()
        is not None
    )


def _has_territory_challenge_win(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(XpLedger.id)
        .filter(
            XpLedger.user_id == user_id,
            XpLedger.entry_type == "bonus",
            XpLedger.xp == 100,
        )
        .first()
        is not None
    )


def _friend_wins(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.query(func.count(FriendChallenge.id))
        .filter(
            FriendChallenge.winner_id == user_id,
            FriendChallenge.status == "completed",
        )
        .scalar()
        or 0
    )


def _live_territories(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.query(func.count(HexOwnership.h3_index))
        .filter(
            HexOwnership.owner_id == user_id,
            HexOwnership.superseded_at.is_(None),
        )
        .scalar()
        or 0
    )


def _lifetime_walk_m(db: Session, user_id: uuid.UUID) -> float:
    total = (
        db.query(func.coalesce(func.sum(WalkingSession.total_distance_m), 0.0))
        .filter(
            WalkingSession.user_id == user_id,
            WalkingSession.status == "evaluated",
        )
        .scalar()
    )
    return float(total or 0.0)


# key -> checker(db, user_id) -> bool
DEFINITIONS = [
    ("first_walk", _has_evaluated_walk),
    ("first_capture", _has_ever_captured),
    ("first_challenge_win", _has_territory_challenge_win),
    ("first_friend_win", lambda db, uid: _friend_wins(db, uid) >= 1),
    ("collector_5", lambda db, uid: _live_territories(db, uid) >= 5),
    ("walker_10km", lambda db, uid: _lifetime_walk_m(db, uid) >= 10000),
    ("walker_50km", lambda db, uid: _lifetime_walk_m(db, uid) >= 50000),
    ("rival_5", lambda db, uid: _friend_wins(db, uid) >= 5),
]


def total_xp(db: Session, user_id: uuid.UUID) -> int:
    total = (
        db.query(func.coalesce(func.sum(XpLedger.xp), 0))
        .filter(XpLedger.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


def get_achievements(db: Session, user_id: uuid.UUID) -> dict:
    """Evaluate every definition, award newly-earned rows, return state.

    The caller commits (same pattern as challenge refresh: this
    function never commits by itself).
    """
    awarded = {
        row.achievement_key: row.awarded_at
        for row in db.query(UserAchievement)
        .filter(UserAchievement.user_id == user_id)
        .all()
    }
    now = datetime.now(timezone.utc)
    changed = False
    for key, check in DEFINITIONS:
        if key not in awarded and check(db, user_id):
            db.add(
                UserAchievement(
                    user_id=user_id,
                    achievement_key=key,
                    awarded_at=now,
                )
            )
            awarded[key] = now
            changed = True
    total = total_xp(db, user_id)
    level, progress, to_next = level_for(total)
    return {
        "level": level,
        "total_xp": total,
        "xp_progress": progress,
        "xp_to_next": to_next,
        "achievements": [
            {
                "key": key,
                "unlocked": key in awarded,
                "unlocked_at": awarded.get(key),
            }
            for key, _ in DEFINITIONS
        ],
        "changed": changed,
    }
