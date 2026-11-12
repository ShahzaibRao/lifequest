-- LifeQuest — Migration 002: friendships (P2 social, locked rules 2026-11-04).
--
-- Only pending/accepted rows exist: reject/cancel/unfriend DELETE the row,
-- so a re-send after reject is just a fresh insert. Block is NOT in P2.
-- Apply once, against PostgreSQL 16 + PostGIS (same DB as migration 001).
-- Re-runnable: IF NOT EXISTS guards throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS friendships (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id);

DROP TRIGGER IF EXISTS friendships_set_updated_at ON friendships;
CREATE TRIGGER friendships_set_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
