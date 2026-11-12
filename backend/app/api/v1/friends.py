"""Friends endpoints (P2 social, locked rules 2026-11-04).

- Add: search by display name OR email, request + accept (mutual).
- Visibility: friends see game data only (territories, weekly XP, rank).
  Steps and health logs are never exposed through these endpoints.
- Lifecycle: send -> pending; accept = mutual friends; reject = row
  deleted (re-send allowed); sender can cancel before answer; unfriend
  deletes the accepted row. Block is NOT in P2.
- Only pending/accepted rows exist in `friendships` — there is no
  rejected/cancelled state to go stale.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.friendship import Friendship
from app.models.territory import XpLedger
from app.models.user import User
from app.schemas.friend import (
    FriendActionResult,
    FriendListEntry,
    FriendRequestCreate,
    FriendRequestItem,
    FriendSearchResult,
    PendingRequests,
)
from app.schemas.territory import LeaderboardEntry, LeaderboardResponse, WeeklyLeaderboard
from app.api.v1.leaderboard import PERIODS, _me_stats, _period_bounds
from app.services.evaluation import _week_start_pk

router = APIRouter(prefix="/friends", tags=["friends"])


def _pair_rows(db: Session, a: uuid.UUID, b: uuid.UUID) -> list[Friendship]:
    """All friendship rows between two users, either direction.

    The send endpoint refuses to create a second row while one exists,
    so in practice this is 0 or 1 rows.
    """
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
            )
        )
        .all()
    )


def _status_map(db: Session, me: uuid.UUID) -> dict[uuid.UUID, str]:
    """Other user id -> friendship status relative to me."""
    out: dict[uuid.UUID, str] = {}
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == me,
                Friendship.addressee_id == me,
            )
        )
        .all()
    )
    for row in rows:
        other = row.addressee_id if row.requester_id == me else row.requester_id
        if row.status == "accepted":
            out[other] = "friends"
        elif row.requester_id == me:
            out[other] = "pending_sent"
        else:
            out[other] = "pending_received"
    return out


def _names(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    return {
        user.id: user.display_name
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    }


def _users_by_id(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not user_ids:
        return {}
    return {
        user.id: user
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    }


@router.get("/search", response_model=list[FriendSearchResult])
def search_users(
    q: str = Query(min_length=2, max_length=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if len(term) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="search query too short",
        )
    needle = f"%{term}%"
    users = (
        db.query(User)
        .filter(
            or_(User.display_name.ilike(needle), User.email.ilike(needle)),
            User.id != current_user.id,
        )
        .order_by(User.display_name.asc())
        .limit(20)
        .all()
    )
    statuses = _status_map(db, current_user.id)
    return [
        FriendSearchResult(
            user_id=user.id,
            display_name=user.display_name,
            # Email only when the query matched the email itself.
            email=user.email if term.lower() in user.email.lower() else None,
            status=statuses.get(user.id, "none"),
            avatar_key=user.avatar_key,
            city=user.city,
        )
        for user in users
    ]


@router.post(
    "/requests",
    response_model=FriendRequestItem,
    status_code=status.HTTP_201_CREATED,
)
def send_request(
    body: FriendRequestCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.addressee_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot add yourself",
        )
    addressee = db.get(User, body.addressee_id)
    if addressee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    existing = _pair_rows(db, current_user.id, body.addressee_id)
    if existing:
        if existing[0].status == "accepted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="already friends"
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="friend request already pending",
        )
    row = Friendship(
        requester_id=current_user.id,
        addressee_id=body.addressee_id,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return FriendRequestItem(
        request_id=row.id,
        other_user_id=addressee.id,
        other_display_name=addressee.display_name,
        direction="sent",
        created_at=row.created_at,
    )


@router.get("/requests", response_model=PendingRequests)
def list_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            ),
            Friendship.status == "pending",
        )
        .order_by(Friendship.created_at.asc())
        .all()
    )
    other_ids = [
        row.addressee_id if row.requester_id == current_user.id else row.requester_id
        for row in rows
    ]
    names = _names(db, other_ids)
    users_by_id = _users_by_id(db, other_ids)
    sent: list[FriendRequestItem] = []
    received: list[FriendRequestItem] = []
    for row in rows:
        if row.requester_id == current_user.id:
            other = users_by_id.get(row.addressee_id)
            sent.append(
                FriendRequestItem(
                    request_id=row.id,
                    other_user_id=row.addressee_id,
                    other_display_name=other.display_name if other else "unknown",
                    avatar_key=other.avatar_key if other else None,
                    city=other.city if other else None,
                    direction="sent",
                    created_at=row.created_at,
                )
            )
        else:
            other = users_by_id.get(row.requester_id)
            received.append(
                FriendRequestItem(
                    request_id=row.id,
                    other_user_id=row.requester_id,
                    other_display_name=other.display_name if other else "unknown",
                    avatar_key=other.avatar_key if other else None,
                    city=other.city if other else None,
                    direction="received",
                    created_at=row.created_at,
                )
            )
    return PendingRequests(sent=sent, received=received)


def _pending_row_for(
    db: Session, request_id: uuid.UUID, current_user: User, side: str
) -> Friendship:
    """Pending row the caller is allowed to act on, or 404.

    side 'addressee' for accept/reject, 'requester' for cancel. A 404
    covers not-found, wrong owner, and wrong status alike, so nothing
    about other users' requests leaks.
    """
    row = db.get(Friendship, request_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="request not found"
        )
    owner = row.addressee_id if side == "addressee" else row.requester_id
    if owner != current_user.id or row.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="request not found"
        )
    return row


@router.post("/requests/{request_id}/accept", response_model=FriendActionResult)
def accept_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _pending_row_for(db, request_id, current_user, "addressee")
    row.status = "accepted"
    db.commit()
    return FriendActionResult(user_id=row.requester_id, status="accepted")


@router.post("/requests/{request_id}/reject", response_model=FriendActionResult)
def reject_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _pending_row_for(db, request_id, current_user, "addressee")
    db.delete(row)
    db.commit()
    return FriendActionResult(user_id=row.requester_id, status="rejected")


@router.post("/requests/{request_id}/cancel", response_model=FriendActionResult)
def cancel_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _pending_row_for(db, request_id, current_user, "requester")
    db.delete(row)
    db.commit()
    return FriendActionResult(user_id=row.addressee_id, status="cancelled")


@router.delete("/{friend_id}", response_model=FriendActionResult)
def unfriend(
    friend_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = [
        row for row in _pair_rows(db, current_user.id, friend_id)
        if row.status == "accepted"
    ]
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not friends"
        )
    db.delete(rows[0])
    db.commit()
    return FriendActionResult(user_id=friend_id, status="removed")


@router.get("", response_model=list[FriendListEntry])
def list_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            ),
            Friendship.status == "accepted",
        )
        .all()
    )
    friend_ids = [
        row.addressee_id if row.requester_id == current_user.id else row.requester_id
        for row in rows
    ]
    names = _names(db, friend_ids)
    users_by_id = _users_by_id(db, friend_ids)
    week_start = _week_start_pk(datetime.now(timezone.utc))
    xp_rows = (
        db.query(XpLedger.user_id, func.sum(XpLedger.xp).label("total_xp"))
        .filter(
            XpLedger.user_id.in_(friend_ids),
            XpLedger.week_start == week_start,
        )
        .group_by(XpLedger.user_id)
        .all()
    ) if friend_ids else []
    xp = {row.user_id: int(row.total_xp) for row in xp_rows}
    entries = [
        FriendListEntry(
            user_id=friend_id,
            display_name=names.get(friend_id, "unknown"),
            weekly_xp=xp.get(friend_id, 0),
            avatar_key=users_by_id[friend_id].avatar_key if friend_id in users_by_id else None,
            city=users_by_id[friend_id].city if friend_id in users_by_id else None,
        )
        for friend_id in friend_ids
    ]
    entries.sort(key=lambda entry: entry.display_name.lower())
    return entries


@router.get("/leaderboard/weekly", response_model=WeeklyLeaderboard)
def friends_weekly_leaderboard(
    week_start: date | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Friends leaderboard (P2, locked rules 2026-11-04).

    Same Monday 00:00 Asia/Karachi week as the global board, same XP
    (walk + capture + challenge bonuses), but only you + your accepted
    friends, ranked among friends. Pending requests and unfriended users
    never appear. Friends with 0 XP this week still appear, below the
    scorers; an empty friends list gives empty entries (the client shows
    the add-friend empty state).
    """
    if week_start is None:
        week_start = _week_start_pk(datetime.now(timezone.utc))
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            ),
            Friendship.status == "accepted",
        )
        .all()
    )
    friend_ids = [
        row.addressee_id if row.requester_id == current_user.id else row.requester_id
        for row in rows
    ]
    user_ids = [current_user.id] + friend_ids
    xp_rows = (
        db.query(
            XpLedger.user_id,
            func.sum(XpLedger.xp).label("total_xp"),
        )
        .filter(
            XpLedger.user_id.in_(user_ids),
            XpLedger.week_start == week_start,
        )
        .group_by(XpLedger.user_id)
        .order_by(func.sum(XpLedger.xp).desc(), XpLedger.user_id.asc())
        .all()
    )
    users = _users_by_id(db, user_ids)
    scored = {row.user_id for row in xp_rows}
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            user_id=row.user_id,
            display_name=users[row.user_id].display_name if row.user_id in users else "unknown",
            xp=int(row.total_xp),
            is_me=row.user_id == current_user.id,
            avatar_key=users[row.user_id].avatar_key if row.user_id in users else None,
            city=users[row.user_id].city if row.user_id in users else None,
        )
        for i, row in enumerate(xp_rows)
    ]
    missing = sorted(
        (uid for uid in user_ids if uid not in scored),
        key=lambda uid: (users[uid].display_name if uid in users else "").lower(),
    )
    for uid in missing:
        entries.append(
            LeaderboardEntry(
                rank=len(entries) + 1,
                user_id=uid,
                display_name=users[uid].display_name if uid in users else "unknown",
                xp=0,
                is_me=uid == current_user.id,
                avatar_key=users[uid].avatar_key if uid in users else None,
                city=users[uid].city if uid in users else None,
            )
        )
    return WeeklyLeaderboard(week_start=week_start, entries=entries)


@router.get("/leaderboard", response_model=LeaderboardResponse)
def friends_leaderboard(period: str = Query(default="weekly"), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Friends leaderboard for any period (same rules as weekly friends board)."""
    if period not in PERIODS:
        period = "weekly"
    now = datetime.now(timezone.utc)
    period_start, since = _period_bounds(period, now)
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == current_user.id,
                Friendship.addressee_id == current_user.id,
            ),
            Friendship.status == "accepted",
        )
        .all()
    )
    friend_ids = [
        row.addressee_id if row.requester_id == current_user.id else row.requester_id
        for row in rows
    ]
    user_ids = [current_user.id] + friend_ids
    q = db.query(XpLedger.user_id, func.sum(XpLedger.xp).label("total_xp")).filter(XpLedger.user_id.in_(user_ids))
    if period == "weekly":
        q = q.filter(XpLedger.week_start == period_start)
    elif since is not None:
        q = q.filter(XpLedger.created_at >= since)
    xp_rows = q.group_by(XpLedger.user_id).order_by(func.sum(XpLedger.xp).desc(), XpLedger.user_id.asc()).all()
    users = _users_by_id(db, user_ids)
    scored = {row.user_id for row in xp_rows}
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            user_id=row.user_id,
            display_name=users[row.user_id].display_name if row.user_id in users else "unknown",
            xp=int(row.total_xp),
            is_me=row.user_id == current_user.id,
            avatar_key=users[row.user_id].avatar_key if row.user_id in users else None,
            city=users[row.user_id].city if row.user_id in users else None,
        )
        for i, row in enumerate(xp_rows)
    ]
    missing = sorted(
        (uid for uid in user_ids if uid not in scored),
        key=lambda uid: (users[uid].display_name if uid in users else "").lower(),
    )
    for uid in missing:
        entries.append(
            LeaderboardEntry(
                rank=len(entries) + 1,
                user_id=uid,
                display_name=users[uid].display_name if uid in users else "unknown",
                xp=0,
                is_me=uid == current_user.id,
                avatar_key=users[uid].avatar_key if uid in users else None,
                city=users[uid].city if uid in users else None,
            )
        )
    me_rank = next((e.rank for e in entries if e.is_me), None)
    me_xp = next((e.xp for e in entries if e.is_me), 0)
    stats = _me_stats(db, current_user.id, now)
    return LeaderboardResponse(period=period, period_start=period_start, entries=entries, me_rank=me_rank, me_xp=me_xp, **stats)
