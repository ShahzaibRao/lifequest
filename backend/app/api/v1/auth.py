"""Auth endpoints (LLD Section 2.1).
Register 201 / duplicate 409. Login 401 generic on bad credentials.
Refresh rotates (old revoked). Logout idempotent. GET /me for testing.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.rate_limit import (
    check_login_allowed,
    record_login_failure,
    record_login_success,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.user import RefreshToken, User
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
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


@router.post("/register", response_model=UserResponse, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="email already registered")
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse(
        user_id=user.id, display_name=user.display_name, email=user.email
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = check_login_allowed(payload.email, client_ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="too many login attempts, try again later",
            headers={"Retry-After": str(retry_after)},
        )
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        record_login_failure(payload.email)
        raise HTTPException(status_code=401, detail="invalid email or password")
    record_login_success(payload.email)
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
