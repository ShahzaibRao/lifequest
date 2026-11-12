"""Shared dependency: current user from an access token."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    user_id = decode_token(token, expected_type="access")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return user
