"""Friend-challenge endpoints (P2 social, locked rules 2026-11-04).

MVP, one type: distance race, only between mutual friends.
- Challenger picks target (1/3/5 km) + duration (1/3/7 days).
- Opponent has 24h to accept/decline, else the challenge expires.
- First to target wins; if nobody reaches target by the deadline, the
  leader wins; a tie is a draw (no bonus).
- Winner gets +50 XP (xp_ledger entry_type 'bonus',
  keyed by the challenge id, so re-finalize attempts are idempotent).
- At most one open (pending or active) challenge per friend pair.
- Only evaluated sessions' valid distance counts: total_distance_m of
  sessions ending inside [accepted_at, deadline_at].
- Progress/finalization is lazy on read: every read refreshes pending
  expiry and active completion. Finalization locks the challenge row,
  so concurrent reads cannot award the bonus twice. Endpoints commit
  whatever the refresh changed; the refresh itself never commits.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.challenge import FriendChallenge
from app.models.friendship import Friendship
from app.models.session import WalkingSession
from app.models.territory import XpLedger
from app.models.user import User
from app.schemas.challenge import ChallengeCreate, ChallengeItem
from app.services.evaluation import _week_start_pk

router = APIRouter(prefix="/challenges", tags=["challenges"])

TARGETS_M = (1000, 3000, 5000)
DURATIONS_DAYS = (1, 3, 7)
RESPONSE_HOURS = 24
WINNER_BONUS_XP = 50
BONUS_ENTRY_TYPE = "bonus"


def _is_friend(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    return (
        db.query(Friendship)
        .filter(
            or_(
                and_(
                    Friendship.requester_id == a,
                    Friendship.addressee_id == b,
                ),
                and_(
                    Friendship.requester_id == b,
                    Friendship.addressee_id == a,
                ),
            ),
            Friendship.status == "accepted",
        )
        .first()
        is not None
    )


def _pair_challenges(
    db: Session, a: uuid.UUID, b: uuid.UUID
) -> list[FriendChallenge]:
    return (
        db.query(FriendChallenge)
        .filter(
            or_(
                and_(
                    FriendChallenge.challenger_id == a,
                    FriendChallenge.opponent_id == b,
                ),
                and_(
                    FriendChallenge.challenger_id == b,
                    FriendChallenge.opponent_id == a,
                ),
            )
        )
        .all()
    )


def _valid_distance(
    db: Session, user_id: uuid.UUID, start: datetime, end: datetime
) -> float:
    """Valid metres walked in a window: evaluated sessions ending inside it."""
    total = (
        db.query(func.coalesce(func.sum(WalkingSession.total_distance_m), 0.0))
        .filter(
            WalkingSession.user_id == user_id,
            WalkingSession.status == "evaluated",
            WalkingSession.ended_at >= start,
            WalkingSession.ended_at <= end,
        )
        .scalar()
    )
    return float(total or 0.0)


def _refresh_challenge(
    db: Session, ch: FriendChallenge, now: datetime
) -> bool:
    """Refresh one challenge in place. Returns True if it changed.

    Pending + past expiry -> expired. Active + (target reached or
    deadline passed) -> completed under a row lock, with the winner
    bonus written in the same transaction. Active progress distances
    are updated whenever they moved.
    """
    if ch.status == "pending":
        if now > ch.expires_at:
            ch.status = "expired"
            return True
        return False
    if (
        ch.status != "active"
        or ch.accepted_at is None
        or ch.deadline_at is None
    ):
        return False
    cd = _valid_distance(db, ch.challenger_id, ch.accepted_at, ch.deadline_at)
    od = _valid_distance(db, ch.opponent_id, ch.accepted_at, ch.deadline_at)
    changed = (
        cd != ch.challenger_distance_m or od != ch.opponent_distance_m
    )
    if changed:
        ch.challenger_distance_m = cd
        ch.opponent_distance_m = od
    finished = (
        cd >= ch.target_m or od >= ch.target_m or now >= ch.deadline_at
    )
    if not finished:
        return changed
    # Finish under a row lock: a concurrent read blocks here, then sees
    # status completed and skips, so the bonus is awarded exactly once.
    locked = (
        db.query(FriendChallenge)
        .filter(FriendChallenge.id == ch.id)
        .with_for_update()
        .one()
    )
    if locked.status != "active":
        return changed
    locked.challenger_distance_m = cd
    locked.opponent_distance_m = od
    if cd > od:
        winner: uuid.UUID | None = locked.challenger_id
    elif od > cd:
        winner = locked.opponent_id
    else:
        winner = None
    locked.winner_id = winner
    locked.status = "completed"
    locked.completed_at = now
    if winner is not None:
        db.add(
            XpLedger(
                user_id=winner,
                session_uuid=locked.id,
                entry_type=BONUS_ENTRY_TYPE,
                xp=WINNER_BONUS_XP,
                week_start=_week_start_pk(now),
            )
        )
    return True


def _items(db: Session, rows: list[FriendChallenge]) -> list[ChallengeItem]:
    ids = {
        uid for ch in rows for uid in (ch.challenger_id, ch.opponent_id)
    }
    names = (
        {
            user.id: user.display_name
            for user in db.query(User).filter(User.id.in_(list(ids))).all()
        }
        if ids
        else {}
    )
    return [
        ChallengeItem(
            challenge_id=ch.id,
            challenger_id=ch.challenger_id,
            opponent_id=ch.opponent_id,
            challenger_display_name=names.get(ch.challenger_id, "unknown"),
            opponent_display_name=names.get(ch.opponent_id, "unknown"),
            target_m=ch.target_m,
            duration_days=ch.duration_days,
            status=ch.status,
            winner_id=ch.winner_id,
            challenger_distance_m=ch.challenger_distance_m,
            opponent_distance_m=ch.opponent_distance_m,
            expires_at=ch.expires_at,
            accepted_at=ch.accepted_at,
            deadline_at=ch.deadline_at,
            completed_at=ch.completed_at,
            created_at=ch.created_at,
        )
        for ch in rows
    ]


@router.post("", response_model=ChallengeItem, status_code=status.HTTP_201_CREATED)
def create_challenge(
    body: ChallengeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    if body.target_m not in TARGETS_M:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="target_m must be 1000, 3000 or 5000",
        )
    if body.duration_days not in DURATIONS_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="duration_days must be 1, 3 or 7",
        )
    if body.opponent_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot challenge yourself",
        )
    opponent = db.get(User, body.opponent_id)
    if opponent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    if not _is_friend(db, current_user.id, body.opponent_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="can only challenge friends",
        )
    existing = _pair_challenges(db, current_user.id, body.opponent_id)
    changed = False
    for ch in existing:
        if _refresh_challenge(db, ch, now):
            changed = True
    if changed:
        db.commit()
    if any(ch.status in ("pending", "active") for ch in existing):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="challenge already open with this friend",
        )
    row = FriendChallenge(
        challenger_id=current_user.id,
        opponent_id=body.opponent_id,
        target_m=body.target_m,
        duration_days=body.duration_days,
        status="pending",
        expires_at=now + timedelta(hours=RESPONSE_HOURS),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _items(db, [row])[0]


@router.get("", response_model=list[ChallengeItem])
def list_challenges(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    rows = (
        db.query(FriendChallenge)
        .filter(
            or_(
                FriendChallenge.challenger_id == current_user.id,
                FriendChallenge.opponent_id == current_user.id,
            )
        )
        .order_by(FriendChallenge.created_at.desc())
        .all()
    )
    changed = False
    for ch in rows:
        if _refresh_challenge(db, ch, now):
            changed = True
    if changed:
        db.commit()
    return _items(db, rows)


@router.get("/{challenge_id}", response_model=ChallengeItem)
def get_challenge(
    challenge_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    ch = db.get(FriendChallenge, challenge_id)
    if ch is None or current_user.id not in (ch.challenger_id, ch.opponent_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="challenge not found"
        )
    if _refresh_challenge(db, ch, now):
        db.commit()
    return _items(db, [ch])[0]


def _pending_for_opponent(
    db: Session, challenge_id: uuid.UUID, current_user: User
) -> FriendChallenge:
    """Pending challenge the caller (as opponent) may answer, or 404/409."""
    ch = db.get(FriendChallenge, challenge_id)
    if ch is None or ch.opponent_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="challenge not found"
        )
    now = datetime.now(timezone.utc)
    if ch.status == "pending" and now > ch.expires_at:
        ch.status = "expired"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="challenge expired"
        )
    if ch.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="challenge not pending"
        )
    return ch


@router.post("/{challenge_id}/accept", response_model=ChallengeItem)
def accept_challenge(
    challenge_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ch = _pending_for_opponent(db, challenge_id, current_user)
    now = datetime.now(timezone.utc)
    ch.status = "active"
    ch.accepted_at = now
    ch.deadline_at = now + timedelta(days=ch.duration_days)
    db.commit()
    return _items(db, [ch])[0]


@router.post("/{challenge_id}/decline", response_model=ChallengeItem)
def decline_challenge(
    challenge_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ch = _pending_for_opponent(db, challenge_id, current_user)
    ch.status = "declined"
    db.commit()
    return _items(db, [ch])[0]
