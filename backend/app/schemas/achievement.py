"""Achievement shapes (XP levels + Achievements, locked 2026-11-05).

The backend returns achievement KEYS only; titles/descriptions live
in the mobile i18n files (achievements.* keys). Same rule as other
server texts: the server sends data, the app translates UI.
"""

from datetime import datetime

from pydantic import BaseModel


class AchievementItem(BaseModel):
    key: str
    unlocked: bool
    unlocked_at: datetime | None = None


class AchievementsResponse(BaseModel):
    level: int
    total_xp: int
    # XP progress inside the current level (0-99).
    xp_progress: int
    # XP still needed for the next level (1-100).
    xp_to_next: int
    achievements: list[AchievementItem]
