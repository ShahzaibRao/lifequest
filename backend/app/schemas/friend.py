"""Friend shapes (P2 social, locked rules 2026-11-04)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class FriendRequestCreate(BaseModel):
    addressee_id: uuid.UUID


class FriendSearchResult(BaseModel):
    user_id: uuid.UUID
    display_name: str
    # Email is returned ONLY when the search query matched the email;
    # display-name matches never leak the address.
    email: str | None = None
    # none | pending_sent | pending_received | friends
    status: str
    avatar_key: str | None = None
    city: str | None = None


class FriendRequestItem(BaseModel):
    request_id: uuid.UUID
    other_user_id: uuid.UUID
    other_display_name: str
    # sent | received
    direction: str
    created_at: datetime
    avatar_key: str | None = None
    city: str | None = None


class PendingRequests(BaseModel):
    sent: list[FriendRequestItem]
    received: list[FriendRequestItem]


class FriendActionResult(BaseModel):
    user_id: uuid.UUID
    # accepted | rejected | cancelled | removed
    status: str


class FriendListEntry(BaseModel):
    user_id: uuid.UUID
    display_name: str
    weekly_xp: int
    avatar_key: str | None = None
    city: str | None = None
