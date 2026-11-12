"""LifeQuest API. Routers arrive one step at a time, per LLD Section 2:
health (Step 2), auth (Step 3). Next: health logs, sessions,
territory, leaderboard, insights.
"""
from fastapi import FastAPI

from app.api.v1 import achievements, auth, challenges, exercise, friends, health, health_logs, sessions, leaderboard, territories, insights, admin, users, live
from app.core.config import settings

app = FastAPI(title="LifeQuest API", version=settings.app_version)
app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(friends.router, prefix="/api/v1")
app.include_router(challenges.router, prefix="/api/v1")
app.include_router(health_logs.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(territories.router, prefix="/api/v1")
app.include_router(leaderboard.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(achievements.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(live.router, prefix="/api/v1")
app.include_router(exercise.router, prefix="/api/v1")


@app.get("/")
def root():
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
    }
