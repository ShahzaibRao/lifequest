-- 009_exercise_logs.sql
-- Manual exercise entries (B7): gym, running, cycling, etc. logged by hand.
-- Calories are estimated server-side (duration x type factor) so the
-- mobile only sends type + minutes.
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/009_exercise_logs.sql

CREATE TABLE IF NOT EXISTS exercise_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_type TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    calories INTEGER NOT NULL DEFAULT 0,
    logged_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_date ON exercise_logs(user_id, logged_date);
