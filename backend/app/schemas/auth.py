"""Auth request/response shapes (LLD Section 2.1).
Google OAuth only — no passwords (RegisterRequest/LoginRequest removed).
"""
import uuid

from pydantic import BaseModel, EmailStr


class GoogleLoginRequest(BaseModel):
    id_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: EmailStr


class MeResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: EmailStr
