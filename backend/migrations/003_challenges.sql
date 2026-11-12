-- LifeQuest — Migration 003: friend challenges (P2 social, locked rules 2026-11-04).
--
-- MVP, one type: distance race, only between mutual friends.
-- Terminal rows are KEPT (unlike friendships, where reject/cancel/unfriend
-- delete the row): past challenges are history the users can look back on.
-- Winner bonus XP is keyed by the challenge id in xp_ledger
-- (entry_type 'friend_challenge_bonus'), so re-finalize attempts are
-- idempotent by the UNIQUE (session_uuid, entry_type) constraint.
-- Apply once, against PostgreSQL 16 + PostGIS (same DB as migration 001).
-- Re-runnable: IF NOT EXISTS guards throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS friend_challenges (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenger_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    opponent_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_m              INT NOT NULL CHECK (target_m IN (1000, 3000, 5000)),
    duration_days         INT NOT NULL CHECK (duration_days IN (1, 3, 7)),
    status                TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'declined', 'expired')),
    winner_id             UUID REFERENCES users (id) ON DELETE SET NULL,
    challenger_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    opponent_distance_m   DOUBLE PRECISION NOT NULL DEFAULT 0,
    expires_at            TIMESTAMPTZ NOT NULL,
    accepted_at           TIMESTAMPTZ,
    deadline_at           TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (challenger_id <> opponent_id)
);
CREATE INDEX IF NOT EXISTS friend_challenges_challenger_idx ON friend_challenges (challenger_id);
CREATE INDEX IF NOT EXISTS friend_challenges_opponent_idx ON friend_challenges (opponent_id);

DROP TRIGGER IF EXISTS friend_challenges_set_updated_at ON friend_challenges;
CREATE TRIGGER friend_challenges_set_updated_at
    BEFORE UPDATE ON friend_challenges
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
