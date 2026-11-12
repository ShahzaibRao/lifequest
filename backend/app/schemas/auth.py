"""Auth request/response shapes (LLD Section 2.1)."""
import uuid

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)
    display_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
