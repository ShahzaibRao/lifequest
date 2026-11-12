"""Profile shapes + avatar preset list (single source of truth).

The preset list lives here so the PATCH validator (auth.py) and the
picker endpoint (users.py) can never drift apart; mobile fetches the
list from GET /users/avatar-presets instead of hardcoding it.
"""

import uuid

from pydantic import BaseModel, Field


class AvatarPreset(BaseModel):
    key: str
    icon: str
    color: str


AVATAR_PRESETS: list[dict[str, str]] = [
    {"key": "rocket-red", "icon": "rocket", "color": "#ef4444"},
    {"key": "leaf-green", "icon": "leaf", "color": "#22c55e"},
    {"key": "star-amber", "icon": "star", "color": "#f59e0b"},
    {"key": "planet-blue", "icon": "planet", "color": "#3b82f6"},
    {"key": "musical-notes-purple", "icon": "musical-notes", "color": "#a855f7"},
    {"key": "game-controller-pink", "icon": "game-controller", "color": "#ec4899"},
    {"key": "bicycle-teal", "icon": "bicycle", "color": "#14b8a6"},
    {"key": "boat-cyan", "icon": "boat", "color": "#06b6d4"},
    {"key": "flame-orange", "icon": "flame", "color": "#f97316"},
    {"key": "heart-rose", "icon": "heart", "color": "#e11d48"},
    {"key": "moon-indigo", "icon": "moon", "color": "#6366f1"},
    {"key": "sunny-yellow", "icon": "sunny", "color": "#eab308"},
    {"key": "cloud-slate", "icon": "cloud", "color": "#94a3b8"},
    {"key": "diamond-sky", "icon": "diamond", "color": "#0ea5e9"},
    {"key": "trophy-gold", "icon": "trophy", "color": "#d97706"},
    {"key": "book-violet", "icon": "book", "color": "#7c3aed"},
    {"key": "camera-pink", "icon": "camera", "color": "#db2777"},
    {"key": "pizza-orange", "icon": "pizza", "color": "#ea580c"},
    {"key": "paw-green", "icon": "paw", "color": "#16a34a"},
    {"key": "flash-yellow", "icon": "flash", "color": "#facc15"},
]

AVATAR_PRESET_KEYS: set[str] = {p["key"] for p in AVATAR_PRESETS}


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=50)
    city: str | None = Field(default=None, max_length=50)
    bio: str | None = Field(default=None, max_length=280)
    avatar_key: str | None = None


class ProfileResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: str
    city: str | None = None
    bio: str | None = None
    avatar_key: str | None = None


class PublicProfileResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    city: str | None = None
    bio: str | None = None
    avatar_key: str | None = None
    level: int
    total_xp: int
    territories_count: int
    weekly_xp: int
    weekly_rank: int
    achievements_count: int
