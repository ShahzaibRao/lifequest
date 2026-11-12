"""Territory evaluation engine (LLD Section 4, anti-cheat Section 5)."""

import logging
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from h3.api import basic_int as h3
from sqlalchemy.orm import Session

from app.models.session import SessionPoint, WalkingSession
from app.models.territory import FlaggedSession, HexOwnership, SessionHexDistance, XpLedger

logger = logging.getLogger(__name__)

RESOLUTION = 9
MIN_SPEED_KMH = 0.5
MAX_SPEED_KMH = 12.0
MAX_ACCURACY_M = 25.0
JUMP_M = 500.0
NEAR_STATIONARY_M = 20.0
CAPTURE_M = 100.0
REFRESH_M = 50.0
SCORE_CAP_M = 200.0
OWNERSHIP_DAYS = 7
LOCK_HOURS = 24
EARTH_R_M = 6371008.8
PKT = ZoneInfo("Asia/Karachi")


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(a))


def _to_xy(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * EARTH_R_M
    y = math.radians(lat - lat0) * EARTH_R_M
    return (x, y)


def _to_latlng(x: float, y: float, lat0: float, lon0: float) -> tuple[float, float]:
    lat = lat0 + math.degrees(y / EARTH_R_M)
    lon = lon0 + math.degrees(x / (math.cos(math.radians(lat0)) * EARTH_R_M))
    return (lat, lon)


def _segment_intersection(p, r, q, s) -> float | None:
    denom = r[0] * s[1] - r[1] * s[0]
    if abs(denom) < 1e-12:
        return None
    qp = (q[0] - p[0], q[1] - p[1])
    u = (qp[0] * s[1] - qp[1] * s[0]) / denom
    v = (qp[0] * r[1] - qp[1] * r[0]) / denom
    if 0.0 <= u <= 1.0 and 0.0 <= v <= 1.0:
        return u
    return None


def clip_segment_to_cells(lat1: float, lon1: float, lat2: float, lon2: float, seg_dist_m: float) -> dict[int, float]:
    cell1 = h3.latlng_to_cell(lat1, lon1, RESOLUTION)
    cell2 = h3.latlng_to_cell(lat2, lon2, RESOLUTION)
    if cell1 == cell2:
        return {cell1: seg_dist_m}
    lat0, lon0 = (lat1 + lat2) / 2, (lon1 + lon2) / 2
    start = _to_xy(lat1, lon1, lat0, lon0)
    end = _to_xy(lat2, lon2, lat0, lon0)
    planar_len = math.hypot(end[0] - start[0], end[1] - start[1])
    if planar_len < 1e-9:
        return {cell1: seg_dist_m}
    result: dict[int, float] = {}
    current_xy = start
    current_cell = cell1
    for _ in range(100):
        remainder = (end[0] - current_xy[0], end[1] - current_xy[1])
        rem_len = math.hypot(*remainder)
        if rem_len < 0.01:
            break
        boundary = h3.cell_to_boundary(current_cell)
        poly = [_to_xy(lat, lon, lat0, lon0) for lat, lon in boundary]
        u_exit: float | None = None
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            edge = (b[0] - a[0], b[1] - a[1])
            u = _segment_intersection(current_xy, remainder, a, edge)
            if u is not None and 1e-9 < u <= 1.0 and (u_exit is None or u < u_exit):
                u_exit = u
        if u_exit is None:
            result[current_cell] = result.get(current_cell, 0.0) + rem_len
            break
        piece_len = u_exit * rem_len
        result[current_cell] = result.get(current_cell, 0.0) + piece_len
        exit_xy = (current_xy[0] + u_exit * remainder[0], current_xy[1] + u_exit * remainder[1])
        unit = (remainder[0] / rem_len, remainder[1] / rem_len)
        beyond = (exit_xy[0] + unit[0] * 0.5, exit_xy[1] + unit[1] * 0.5)
        beyond_latlng = _to_latlng(beyond[0], beyond[1], lat0, lon0)
        next_cell = h3.latlng_to_cell(beyond_latlng[0], beyond_latlng[1], RESOLUTION)
        if next_cell == current_cell:
            result[current_cell] = result.get(current_cell, 0.0) + 0.5
            current_xy = beyond
        else:
            current_cell = next_cell
            current_xy = exit_xy
    else:
        raise ValueError("segment clipping did not converge within 100 cells")
    return result


def validate_segments(points: list[SessionPoint], total_steps: int | None):
    flags: list[dict] = []
    stats = {"total_segments": 0, "speed_discarded": 0, "accuracy_discarded": 0, "jump_discarded": 0, "low_accuracy_points": 0}
    if points:
        stats["low_accuracy_points"] = sum(1 for p in points if p.accuracy_m is None or p.accuracy_m > MAX_ACCURACY_M)
    pairs = []
    for i in range(len(points) - 1):
        p1, p2 = points[i], points[i + 1]
        dist = haversine_m(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
        dt = (_as_aware(p2.recorded_at) - _as_aware(p1.recorded_at)).total_seconds()
        pairs.append((p1, p2, dist, dt))
    valid = []
    for i, (p1, p2, dist, dt) in enumerate(pairs):
        stats["total_segments"] += 1
        if p1.accuracy_m is None or p1.accuracy_m > MAX_ACCURACY_M or p2.accuracy_m is None or p2.accuracy_m > MAX_ACCURACY_M:
            stats["accuracy_discarded"] += 1
            continue
        if dt <= 0:
            continue
        speed_kmh = dist / dt * 3.6
        if speed_kmh < MIN_SPEED_KMH or speed_kmh > MAX_SPEED_KMH:
            stats["speed_discarded"] += 1
            continue
        neighbours = []
        if i > 0:
            neighbours.append(pairs[i - 1][2])
        if i < len(pairs) - 1:
            neighbours.append(pairs[i + 1][2])
        if dist > JUMP_M and any(n < NEAR_STATIONARY_M for n in neighbours):
            stats["jump_discarded"] += 1
            continue
        valid.append((p1, p2, dist))
    total = stats["total_segments"]
    if total > 0 and stats["speed_discarded"] / total > 0.3:
        flags.append({"code": "SPEED_VIOLATION", "detail": f"{stats['speed_discarded']} of {total} segments discarded for speed"})
    if points and stats["low_accuracy_points"] / len(points) > 0.3:
        flags.append({"code": "LOW_ACCURACY", "detail": f"{stats['low_accuracy_points']} of {len(points)} points above 25 m accuracy or unknown"})
    if stats["jump_discarded"] >= 3:
        flags.append({"code": "LOCATION_JUMP", "detail": f"{stats['jump_discarded']} jump segments over 500 m beside near-stationary neighbours"})
    if total_steps is not None and total_steps > 0:
        gps_m = sum(dist for _, _, dist in valid)
        if gps_m > total_steps * 1.0 + 500 and gps_m > total_steps * 0.75 * 1.4:
            flags.append({"code": "STEP_MISMATCH", "detail": f"valid GPS distance {gps_m:.1f} m implausible for {total_steps} steps"})
    return valid, flags, stats


def _week_start_pk(now: datetime) -> object:
    local_date = now.astimezone(PKT).date()
    return local_date - timedelta(days=local_date.weekday())


def _gps_only_repeat(db: Session, session: WalkingSession, now: datetime) -> bool:
    if session.total_steps is not None:
        return False
    since = now - timedelta(days=7)
    prior = db.query(WalkingSession).filter(WalkingSession.user_id == session.user_id, WalkingSession.status == "evaluated").all()
    count = 0
    for old in prior:
        if _as_aware(old.created_at) < since:
            continue
        result = old.evaluation_result or {}
        if any(hex_row.get("outcome") in ("captured", "challenged") for hex_row in result.get("per_hex", [])):
            count += 1
    return count >= 3


def evaluate_session(db: Session, session: WalkingSession, bypass_flags: bool = False) -> WalkingSession:
    if session.status not in ("pending_evaluation", "flagged"):
        raise ValueError(f"cannot evaluate session in status {session.status}")
    now = datetime.now(timezone.utc)
    if session.status == "flagged":
        db.query(SessionHexDistance).filter(SessionHexDistance.session_uuid == session.session_uuid).delete()
        db.flush()
    points = db.query(SessionPoint).filter(SessionPoint.session_uuid == session.session_uuid).order_by(SessionPoint.seq).all()
    valid_segments, flags, _stats = validate_segments(points, session.total_steps)
    per_cell: dict[int, float] = {}
    for p1, p2, dist in valid_segments:
        for cell, piece in clip_segment_to_cells(p1.latitude, p1.longitude, p2.latitude, p2.longitude, dist).items():
            per_cell[cell] = per_cell.get(cell, 0.0) + piece
    total_valid = sum(per_cell.values())
    if _gps_only_repeat(db, session, now):
        flags.append({"code": "GPS_ONLY_REPEAT", "detail": "3+ GPS-only territory captures in the last 7 days"})
    per_hex_out = [{"h3_index": cell, "valid_distance_m": round(distance, 2), "outcome": None} for cell, distance in sorted(per_cell.items())]
    if flags and not bypass_flags:
        for row in per_hex_out:
            db.add(SessionHexDistance(session_uuid=session.session_uuid, h3_index=row["h3_index"], valid_distance_m=row["valid_distance_m"], outcome=None))
        session.total_distance_m = total_valid
        session.evaluation_result = {"per_hex": [{"h3_index": str(row["h3_index"]), "valid_distance_m": row["valid_distance_m"], "outcome": row["outcome"]} for row in per_hex_out], "xp": {"walk": 0, "bonus": 0, "total": 0}, "total_valid_distance_m": round(total_valid, 2), "flags": flags}
        session.status = "flagged"
        existing_flag = db.query(FlaggedSession).filter(FlaggedSession.session_uuid == session.session_uuid).first()
        if existing_flag is not None:
            existing_flag.reasons = flags
            existing_flag.review_status = "pending"
        else:
            db.add(FlaggedSession(session_uuid=session.session_uuid, reasons=flags, review_status="pending"))
        db.commit()
        return session
    captures = 0
    challenges = 0
    for row in per_hex_out:
        cell = row["h3_index"]
        valid = row["valid_distance_m"]
        query = db.query(HexOwnership).filter(HexOwnership.h3_index == cell, HexOwnership.superseded_at.is_(None))
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            query = query.with_for_update()
        live = query.first()
        outcome = "ignored"
        if live is not None and _as_aware(live.expires_at) <= now:
            live.superseded_at = now
            db.flush()
            live = None
        if live is None:
            if valid >= CAPTURE_M:
                centre_lat, centre_lon = h3.cell_to_latlng(cell)
                db.add(HexOwnership(h3_index=cell, owner_id=session.user_id, hex_score_m=min(valid, SCORE_CAP_M), captured_at=now, expires_at=now + timedelta(days=OWNERSHIP_DAYS), locked_until=now + timedelta(hours=LOCK_HOURS), superseded_at=None, source_session_uuid=session.session_uuid, centre_lat=centre_lat, centre_lon=centre_lon))
                outcome = "captured"
                captures += 1
        elif live.owner_id == session.user_id:
            if valid >= REFRESH_M:
                live.expires_at = now + timedelta(days=OWNERSHIP_DAYS)
                if valid > live.hex_score_m:
                    live.hex_score_m = min(valid, SCORE_CAP_M)
                outcome = "refreshed"
        else:
            if _as_aware(live.locked_until) > now:
                outcome = "failed"
            elif valid > live.hex_score_m:
                live.superseded_at = now
                db.flush()
                centre_lat, centre_lon = h3.cell_to_latlng(cell)
                db.add(HexOwnership(h3_index=cell, owner_id=session.user_id, hex_score_m=min(valid, SCORE_CAP_M), captured_at=now, expires_at=now + timedelta(days=OWNERSHIP_DAYS), locked_until=now + timedelta(hours=LOCK_HOURS), superseded_at=None, source_session_uuid=session.session_uuid, centre_lat=centre_lat, centre_lon=centre_lon))
                outcome = "challenged"
                challenges += 1
            else:
                outcome = "failed"
        row["outcome"] = outcome
        db.add(SessionHexDistance(session_uuid=session.session_uuid, h3_index=cell, valid_distance_m=valid, outcome=outcome))
    walk_xp = int(total_valid // 100)
    bonus_xp = 50 * captures + 100 * challenges
    week_start = _week_start_pk(now)
    if walk_xp > 0:
        db.add(XpLedger(user_id=session.user_id, session_uuid=session.session_uuid, entry_type="walk", xp=walk_xp, week_start=week_start))
    if bonus_xp > 0:
        db.add(XpLedger(user_id=session.user_id, session_uuid=session.session_uuid, entry_type="bonus", xp=bonus_xp, week_start=week_start))
    session.total_distance_m = total_valid
    session.evaluation_result = {"per_hex": [{"h3_index": str(row["h3_index"]), "valid_distance_m": row["valid_distance_m"], "outcome": row["outcome"]} for row in per_hex_out], "xp": {"walk": walk_xp, "bonus": bonus_xp, "total": walk_xp + bonus_xp}, "total_valid_distance_m": round(total_valid, 2)}
    if bypass_flags and flags:
        session.evaluation_result["overridden_flags"] = flags
    session.status = "evaluated"
    db.commit()
    return session
