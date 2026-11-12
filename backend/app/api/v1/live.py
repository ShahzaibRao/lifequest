"""Live positions — who is walking right now (2026-11-07).

The map shows owned hexes (territories). This adds LIVE dots: while a user
walks, the app POSTs its current GPS every ~5 s; Redis holds it with a
60 s TTL (so a dot vanishes ~60 s after the user stops). GET /live/map
returns the live dots inside a bbox, so the map can render them.

Storage is Redis only (ephemeral — no DB writes for a position that is
stale in a minute). Fail-open: if Redis is down, POST still returns 200
and GET returns [] — the walk and the map never break because of live dots.

Visibility: FRIENDS ONLY (Rao's call, 2026-11-07). A live dot says
where you are right now, so it is only shown to people you added as a
friend. The server filters on read (GET /live/map); POST just records
your position and never needs to know who is watching.
"""
import json
import logging
import time

from fastapi import APIRouter, Depends, Query
from h3.api import basic_int as h3
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.cache import _get_client
from app.core.database import get_db
from app.models.friendship import Friendship
from app.models.user import User

log = logging.getLogger(__name__)
router = APIRouter(prefix="/live", tags=["live"])

RESOLUTION = 9
LIVE_TTL_SECONDS = 60
LIVE_KEY_PREFIX = "live:"


class LivePositionIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class LiveDot(BaseModel):
    user_id: str
    display_name: str
    latitude: float
    longitude: float
    h3_index: str
    updated_at: float
    avatar_key: str | None = None


@router.post("/position")
def post_live_position(
    payload: LivePositionIn, current_user: User = Depends(get_current_user)
):
    """Record my current position as a live dot (TTL 60 s). Fail-open."""
    try:
        cell = h3.latlng_to_cell(payload.latitude, payload.longitude, RESOLUTION)
    except Exception:
        cell = 0
    data = {
        "user_id": str(current_user.id),
        "display_name": current_user.display_name,
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "h3_index": str(cell),
        "updated_at": time.time(),
        "avatar_key": current_user.avatar_key,
    }
    c = _get_client()
    if c is not None:
        try:
            c.set(
                f"{LIVE_KEY_PREFIX}{current_user.id}",
                json.dumps(data),
                ex=LIVE_TTL_SECONDS,
            )
        except Exception:
            log.warning("live position store failed", exc_info=True)
    return {"ok": True}


@router.get("/map", response_model=list[LiveDot])
def live_map(
    bbox: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Live dots inside a bbox, friends only.
    bbox = minLon,minLat,maxLon,maxLat."""
    # My accepted (mutual) friends — the only users whose live dots I
    # am allowed to see. Same rule as friends.py _status_map.
    me = current_user.id
    friend_ids: set[str] = set()
    rows = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == me,
                Friendship.addressee_id == me,
            ),
            Friendship.status == "accepted",
        )
        .all()
    )
    for row in rows:
        other = row.addressee_id if row.requester_id == me else row.requester_id
        friend_ids.add(str(other))
    try:
        parts = [float(p) for p in bbox.split(",")]
        if len(parts) != 4:
            return []
        min_lon, min_lat, max_lon, max_lat = parts
    except Exception:
        return []
    c = _get_client()
    if c is None:
        return []
    try:
        keys = list(c.scan_iter(f"{LIVE_KEY_PREFIX}*"))
        if not keys:
            return []
        raw = c.mget(keys)
    except Exception:
        return []
    dots: list[LiveDot] = []
    for item in raw:
        if not item:
            continue
        try:
            d = json.loads(item)
        except Exception:
            continue
        lat, lon = d.get("latitude"), d.get("longitude")
        if lat is None or lon is None:
            continue
        # Friends only — and never my own dot (the map already shows me
        # via UserLocation).
        if d.get("user_id") not in friend_ids:
            continue
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            dots.append(LiveDot(**d))
    return dots
