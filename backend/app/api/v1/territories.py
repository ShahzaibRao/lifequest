"""Territory map and my-territories endpoints (LLD Section 2.4)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from h3.api import basic_int as h3
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.territory import HexOwnership
from app.models.user import User
from app.schemas.territory import TerritoryMapItem, TerritoryMeItem
from app.services.evaluation import _as_aware

router = APIRouter(prefix="/territories", tags=["territories"])

MAX_BBOX_SIDE_DEG = 0.1


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    try:
        parts = [float(p) for p in bbox.split(",")]
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bbox must be minLon,minLat,maxLon,maxLat as numbers")
    if len(parts) != 4:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bbox must have exactly 4 values: minLon,minLat,maxLon,maxLat")
    min_lon, min_lat, max_lon, max_lat = parts
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="longitude out of range")
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="latitude out of range")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bbox min must be below max on both axes")
    if max_lon - min_lon > MAX_BBOX_SIDE_DEG or max_lat - min_lat > MAX_BBOX_SIDE_DEG:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bbox side over 0.1 degrees: zoom in")
    return min_lon, min_lat, max_lon, max_lat


def _live_rows(db: Session, now: datetime):
    rows = db.query(HexOwnership, User.display_name, User.avatar_key).join(User, User.id == HexOwnership.owner_id).filter(HexOwnership.superseded_at.is_(None)).all()
    return [(row, name, avatar_key) for row, name, avatar_key in rows if _as_aware(row.expires_at) > now]


@router.get("/map", response_model=list[TerritoryMapItem])
def territory_map(bbox: str = Query(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
    now = datetime.now(timezone.utc)
    items = []
    for row, display_name, avatar_key in _live_rows(db, now):
        if not (min_lon <= row.centre_lon <= max_lon and min_lat <= row.centre_lat <= max_lat):
            continue
        boundary = [[lon, lat] for lat, lon in h3.cell_to_boundary(row.h3_index)]
        boundary.append(boundary[0])
        items.append(TerritoryMapItem(h3_index=str(row.h3_index), owner_display_name=display_name, owner_user_id=str(row.owner_id), avatar_key=avatar_key, is_mine=row.owner_id == current_user.id, hex_score_m=row.hex_score_m, expires_at=row.expires_at, locked_until=row.locked_until, boundary=boundary))
    return items


@router.get("/me", response_model=list[TerritoryMeItem])
def my_territories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = [(row, _name) for row, _name, _avatar in _live_rows(db, now) if row.owner_id == current_user.id]
    rows.sort(key=lambda pair: _as_aware(pair[0].expires_at))
    return [TerritoryMeItem(h3_index=str(row.h3_index), hex_score_m=row.hex_score_m, expires_at=row.expires_at, locked_until=row.locked_until, seconds_remaining=max(0, int((_as_aware(row.expires_at) - now).total_seconds()))) for row, _ in rows]
