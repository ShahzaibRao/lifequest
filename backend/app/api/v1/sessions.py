"""Walking session upload endpoints (LLD Section 2.3)."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.session import SessionPoint, WalkingSession
from app.models.territory import Job
from app.models.user import User
from app.schemas.session import ChunkCreate, SessionResponse, SessionStartCreate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _last_uploaded_seq(db: Session, session_uuid: uuid.UUID) -> int:
    value = db.query(func.max(SessionPoint.seq)).filter(SessionPoint.session_uuid == session_uuid).scalar()
    return int(value) if value is not None else 0


def _points_count(db: Session, session_uuid: uuid.UUID) -> int:
    return db.query(SessionPoint).filter(SessionPoint.session_uuid == session_uuid).count()


def _to_response(db: Session, session: WalkingSession) -> SessionResponse:
    return SessionResponse(session_uuid=session.session_uuid, activity_mode=session.activity_mode, status=session.status, started_at=session.started_at, ended_at=session.ended_at, total_steps=session.total_steps, total_distance_m=session.total_distance_m, evaluation_result=session.evaluation_result, last_uploaded_seq=_last_uploaded_seq(db, session.session_uuid), points_count=_points_count(db, session.session_uuid))


def _own_session_or_404(db: Session, session_uuid: uuid.UUID, user: User) -> WalkingSession:
    session = db.query(WalkingSession).filter(WalkingSession.session_uuid == session_uuid).first()
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    return session


@router.post("/start", response_model=SessionResponse, status_code=201)
def start_session(payload: SessionStartCreate, response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(WalkingSession).filter(WalkingSession.session_uuid == payload.session_uuid).first()
    if existing is not None:
        if existing.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
        response.status_code = 200
        return _to_response(db, existing)
    session = WalkingSession(session_uuid=payload.session_uuid, user_id=current_user.id, activity_mode=payload.activity_mode, status="uploading", started_at=payload.started_at)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _to_response(db, session)


@router.get("/me", response_model=list[SessionResponse])
def list_my_sessions(limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(WalkingSession).filter(WalkingSession.user_id == current_user.id).order_by(WalkingSession.started_at.desc(), WalkingSession.created_at.desc()).offset(offset).limit(limit).all()
    return [_to_response(db, session) for session in sessions]


@router.get("/{session_uuid}", response_model=SessionResponse)
def get_session(session_uuid: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _own_session_or_404(db, session_uuid, current_user)
    return _to_response(db, session)


@router.post("/{session_uuid}/chunks", response_model=SessionResponse)
def upload_chunk(session_uuid: uuid.UUID, payload: ChunkCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(WalkingSession).filter(WalkingSession.session_uuid == session_uuid).first()
    if session is None:
        session = WalkingSession(session_uuid=session_uuid, user_id=current_user.id, activity_mode="walk", status="uploading", started_at=payload.points[0].recorded_at)
        db.add(session)
        db.flush()
    elif session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    last = _last_uploaded_seq(db, session_uuid)
    if payload.seq_end <= last:
        return _to_response(db, session)
    if session.status in ("evaluated", "flagged", "rejected", "pending_evaluation"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"session is {session.status}, no more chunks accepted")
    if payload.seq_start != last + 1:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"chunk gap: expected seq {last + 1}, got {payload.seq_start}")
    if payload.seq_end != payload.seq_start + len(payload.points) - 1:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="seq_end must equal seq_start + number of points - 1")
    for i, point in enumerate(payload.points):
        if point.seq != payload.seq_start + i:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"point seq out of order at position {i}: expected {payload.seq_start + i}, got {point.seq}")
    for point in payload.points:
        db.add(SessionPoint(session_uuid=session_uuid, seq=point.seq, latitude=point.latitude, longitude=point.longitude, accuracy_m=point.accuracy_m, recorded_at=point.recorded_at))
    if payload.total_steps is not None:
        session.total_steps = payload.total_steps
    if payload.is_final:
        # Phone clock server se peeche ho sakta hai; ended_at kabhi
        # started_at se pehle nahi hona chahiye (DB CHECK). Is liye clamp.
        session.ended_at = max(payload.points[-1].recorded_at, session.started_at)
        session.status = "pending_evaluation"
    db.commit()
    if payload.is_final:
        # Async evaluation (Fix 2, 2026-11-07): final chunk sirf job
        # queue karta hai aur foran jawab deta hai. Worker (30 s poll,
        # batch 20) evaluate_session chalata hai. Sync evaluation yahan
        # se hata di gayi kyunki wo transaction hold karke DB pool
        # khatam karti thi (run4: 30 conns idle in transaction).
        try:
            db.add(Job(job_type="evaluate_session", payload={"session_uuid": str(session_uuid)}, status="pending"))
            db.commit()
        except Exception:
            logger.exception("could not queue evaluate_session job")
            db.rollback()
    db.refresh(session)
    return _to_response(db, session)
