"""Auth endpoints (LLD Section 2.1).
Google OAuth only — no passwords. POST /auth/google takes a Google
ID token, verifies it, finds or creates the user, and returns our
JWT pair. Refresh rotates (old revoked). Logout idempotent.
GET /me for testing.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_token,
)
from app.models.user import RefreshToken, User
from app.schemas.auth import (
    GoogleLoginRequest,
    MeResponse,
    RefreshRequest,
    TokenResponse,
)
from app.schemas.profile import (
    AVATAR_PRESET_KEYS,
    ProfileResponse,
    ProfileUpdateRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_pair(db: Session, user: User) -> TokenResponse:
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh_token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/google", response_model=TokenResponse)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    allowed_audiences = [
        a
        for a in [
            settings.google_client_id,
            settings.google_android_client_id,
            settings.google_ios_client_id,
        ]
        if a
    ]
    if not allowed_audiences:
        raise HTTPException(status_code=503, detail="google login not configured")
    claims = None
    for aud in allowed_audiences:
        try:
            claims = google_id_token.verify_oauth2_token(
                payload.id_token,
                google_requests.Request(),
                aud,
            )
            break
        except ValueError:
            continue
    if claims is None:
        raise HTTPException(status_code=401, detail="invalid google token")
    if not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="email not verified")
    email = claims.get("email")
    sub = claims.get("sub")
    name = claims.get("name")
    if not email or not sub:
        raise HTTPException(status_code=401, detail="invalid google token")
    # Find by Google sub first, else by email (link on first Google login).
    user = db.query(User).filter(User.google_sub == sub).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            if user.google_sub is None:
                user.google_sub = sub
                db.commit()
                db.refresh(user)
            elif user.google_sub != sub:
                raise HTTPException(
                    status_code=401,
                    detail="email already linked to another google account",
                )
    if user is None:
        user = User(
            email=email,
            password_hash=None,
            google_sub=sub,
            display_name=name or email.split("@")[0],
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return _issue_pair(db, user)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    user_id = decode_token(payload.refresh_token, expected_type="refresh")
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_token(payload.refresh_token))
        .first()
    )
    now = datetime.now(timezone.utc)
    if row is None or row.user_id != user_id or row.revoked_at is not None:
        raise HTTPException(status_code=401, detail="invalid token")
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(status_code=401, detail="invalid token")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid token")
    row.revoked_at = now
    db.commit()
    return _issue_pair(db, user)


@router.post("/logout")
def logout(payload: RefreshRequest, db: Session = Depends(get_db)):
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_token(payload.refresh_token))
        .first()
    )
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "ok"}


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)):
    return MeResponse(
        user_id=current_user.id,
        display_name=current_user.display_name,
        email=current_user.email,
    )


@router.patch("/me", response_model=ProfileResponse)
def update_me(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit own profile (name, city, bio, avatar preset).

    Partial update: only fields present in the request change. Explicit
    null clears city/bio/avatar; display_name cannot be blanked.
    """
    provided = payload.model_fields_set
    if "display_name" in provided:
        if payload.display_name is None or not payload.display_name.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="display_name cannot be blank",
            )
        current_user.display_name = payload.display_name.strip()
    if "city" in provided:
        city = payload.city.strip() if payload.city else None
        current_user.city = city or None
    if "bio" in provided:
        bio = payload.bio.strip() if payload.bio else None
        current_user.bio = bio or None
    if "avatar_key" in provided:
        if payload.avatar_key is not None and payload.avatar_key not in AVATAR_PRESET_KEYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="unknown avatar_key",
            )
        current_user.avatar_key = payload.avatar_key
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return ProfileResponse(
        user_id=current_user.id,
        display_name=current_user.display_name,
        email=current_user.email,
        city=current_user.city,
        bio=current_user.bio,
        avatar_key=current_user.avatar_key,
    )

