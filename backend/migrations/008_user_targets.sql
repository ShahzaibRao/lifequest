-- 008_user_targets.sql
-- Per-user targets for Insights (B6): daily steps + weekly distance.
-- One row per user (upserted by the endpoint). Defaults match the
-- hardcoded constants the Today/Weekly cards used before B6.
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/008_user_targets.sql

CREATE TABLE IF NOT EXISTS user_targets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_steps_target INTEGER NOT NULL DEFAULT 10000 CHECK (daily_steps_target > 0),
    weekly_distance_km_target NUMERIC(6, 2) NOT NULL DEFAULT 7.00 CHECK (weekly_distance_km_target > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
