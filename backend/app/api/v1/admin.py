"""Flagged-session review endpoints (LLD Sections 2.7 and 5)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.session import WalkingSession
from app.models.territory import FlaggedSession
from app.models.user import User
from app.services.evaluation import evaluate_session

router = APIRouter(prefix="/admin", tags=["admin"])


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")
    return current_user


def _flagged_or_404(db: Session, session_uuid: uuid.UUID) -> FlaggedSession:
    row = db.query(FlaggedSession).filter(FlaggedSession.session_uuid == session_uuid).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="flagged session not found")
    return row


@router.get("/flagged")
def list_flagged(review_status: str = Query(default="pending", alias="status"), admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if review_status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="status must be pending, approved or rejected")
    rows = db.query(FlaggedSession, WalkingSession, User.display_name).join(WalkingSession, WalkingSession.session_uuid == FlaggedSession.session_uuid).join(User, User.id == WalkingSession.user_id).filter(FlaggedSession.review_status == review_status).order_by(FlaggedSession.created_at).all()
    return [{"session_uuid": str(flag.session_uuid), "user_display_name": display_name, "session_status": session.status, "reasons": flag.reasons, "review_status": flag.review_status, "reviewed_at": flag.reviewed_at, "created_at": flag.created_at} for flag, session, display_name in rows]


@router.post("/flagged/{session_uuid}/approve")
def approve_flagged(session_uuid: uuid.UUID, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    flag = _flagged_or_404(db, session_uuid)
    if flag.review_status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"flagged session already {flag.review_status}")
    session = db.query(WalkingSession).filter(WalkingSession.session_uuid == session_uuid).first()
    if session is None or session.status != "flagged":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="session is not in flagged status")
    try:
        evaluate_session(db, session, bypass_flags=True)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="re-evaluation failed; session stays flagged")
    flag.review_status = "approved"
    flag.reviewed_at = datetime.now(timezone.utc)
    flag.reviewed_by = admin.id
    db.commit()
    db.refresh(session)
    return {"session_uuid": str(session_uuid), "session_status": session.status, "review_status": "approved", "evaluation_result": session.evaluation_result}


@router.post("/flagged/{session_uuid}/reject")
def reject_flagged(session_uuid: uuid.UUID, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    flag = _flagged_or_404(db, session_uuid)
    if flag.review_status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"flagged session already {flag.review_status}")
    session = db.query(WalkingSession).filter(WalkingSession.session_uuid == session_uuid).first()
    if session is None or session.status != "flagged":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="session is not in flagged status")
    session.status = "rejected"
    flag.review_status = "rejected"
    flag.reviewed_at = datetime.now(timezone.utc)
    flag.reviewed_by = admin.id
    db.commit()
    return {"session_uuid": str(session_uuid), "session_status": "rejected", "review_status": "rejected"}
