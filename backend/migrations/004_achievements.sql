-- 004_achievements.sql
-- user_achievements: one row per (user, achievement key), awarded once,
-- never revoked. Awarding is lazy on read (GET /achievements inserts
-- rows for newly-earned milestones).
--
-- Reconstructed 2026-11-07 during the backend recovery (the original
-- 004 file was lost with ~/lifequest/backend). The table shape is taken
-- from app/models/achievement.py (UserAchievement), which is the
-- authoritative schema.
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/004_achievements.sql

CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key VARCHAR NOT NULL,
    awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, achievement_key)
);
