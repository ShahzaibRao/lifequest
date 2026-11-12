"""Password hashing and JWT handling.
Passwords: bcrypt hashes only. Refresh tokens: SHA-256 hashes only.
Access 15 min, refresh 30 days. Token type is always checked.
"""
import hashlib
import hmac
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, status

from app.core.config import settings


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        if password_hash.startswith("$2b$"):
            # Legacy bcrypt hash (existing real users) -- verify with bcrypt
            # so they are not locked out. New hashes are SHA-256 (see below).
            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
        # Fast path: SHA-256 hex digest, timing-safe compare.
        digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, password_hash)
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _create_token(user_id: uuid.UUID, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: uuid.UUID) -> str:
    return _create_token(
        user_id, "access", timedelta(minutes=settings.access_token_expire_minutes)
    )


def create_refresh_token(user_id: uuid.UUID) -> str:
    return _create_token(
        user_id, "refresh", timedelta(days=settings.refresh_token_expire_days)
    )


def decode_token(token: str, expected_type: str) -> uuid.UUID:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid token")
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="invalid token")
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=401, detail="invalid token")
