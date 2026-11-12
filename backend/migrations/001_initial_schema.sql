-- LifeQuest — Migration 001: initial schema (MVP, Walk only)
-- Source: LLD-v1.md, built on locked Territory Rulebook v1.
-- Authority order on any conflict: Rulebook v1 > HLD v1 > LLD v1 > this file.
--
-- Apply once, against PostgreSQL 16 + PostGIS. See README-schema.md
-- in this folder for the exact local commands.
--
-- Key decisions baked into this schema (do not "simplify" them away):
--  1. One live owner per hex is enforced by the partial unique index
--     at the bottom of the hex_ownership section:
--       UNIQUE (h3_index) WHERE superseded_at IS NULL
--     Expired rows MUST be flipped to superseded inside the same
--     transaction that inserts a new owner (LLD Section 4.4). The
--     alternative status='live' form from the LLD discussion is NOT
--     adopted here, so there is exactly one source of truth.
--  2. XP is idempotent: UNIQUE (session_uuid, entry_type) on xp_ledger,
--     and bonus XP is ONE aggregated row per session (walk + bonus),
--     not one row per hex (LLD Section 4.5 correction).
--  3. activity_mode is CHECK-constrained to 'walk'. Adding Run later
--     is a migration + rulebook change, not a silent new value.
--  4. Server timestamps are timestamptz (UTC). Week boundaries are
--     computed in Asia/Karachi by application code, not by the DB.

BEGIN;

-- ---------------------------------------------------------------- extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_point_geom()
RETURNS TRIGGER AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS 'MVP: no weight/age/profile columns. Calories use a fixed 70 kg reference (LLD Section 7).';

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens: hashed, rotating. LLD Section 2 (required in code,
-- table omitted from LLD Section 1 for brevity, included here).
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- ---------------------------------------------------------------- health logs
-- Daily summaries are COMPUTED from these rows, never stored as truth.
CREATE TABLE IF NOT EXISTS health_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('meal', 'water', 'sleep', 'exercise')),
    logged_date DATE NOT NULL,
    payload     JSONB NOT NULL,
    client_uuid UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, client_uuid)
);
CREATE INDEX IF NOT EXISTS health_logs_user_date_idx ON health_logs (user_id, logged_date);

-- ---------------------------------------------------------------- walking sessions
CREATE TABLE IF NOT EXISTS walking_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid       UUID NOT NULL UNIQUE,
    user_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    activity_mode      TEXT NOT NULL DEFAULT 'walk'
                       CHECK (activity_mode = 'walk'),
    status             TEXT NOT NULL DEFAULT 'uploading'
                       CHECK (status IN ('uploading', 'pending_evaluation', 'evaluated', 'flagged', 'rejected')),
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    total_steps        INTEGER CHECK (total_steps IS NULL OR total_steps >= 0),
    total_distance_m   NUMERIC CHECK (total_distance_m IS NULL OR total_distance_m >= 0),
    evaluation_result  JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
COMMENT ON COLUMN walking_sessions.total_steps IS 'NULL means pedometer unavailable, never 0. NULL must not be treated as zero in anti-cheat code.';
COMMENT ON COLUMN walking_sessions.started_at IS 'Client-reported start. NEVER used for ownership ordering; server processing order decides (Rulebook 14.5).';

CREATE INDEX IF NOT EXISTS walking_sessions_user_started_idx
    ON walking_sessions (user_id, started_at DESC);

DROP TRIGGER IF EXISTS walking_sessions_set_updated_at ON walking_sessions;
CREATE TRIGGER walking_sessions_set_updated_at
    BEFORE UPDATE ON walking_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- session points
-- Raw GPS points. Returned ONLY to their owner, never to other users.
CREATE TABLE IF NOT EXISTS session_points (
    id          BIGSERIAL PRIMARY KEY,
    session_uuid UUID NOT NULL REFERENCES walking_sessions (session_uuid) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_m  DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    recorded_at TIMESTAMPTZ NOT NULL,
    geom        geography(Point, 4326) NOT NULL,
    UNIQUE (session_uuid, seq)
);
CREATE INDEX IF NOT EXISTS session_points_session_seq_idx ON session_points (session_uuid, seq);
CREATE INDEX IF NOT EXISTS session_points_geom_idx ON session_points USING GIST (geom);

DROP TRIGGER IF EXISTS session_points_set_geom ON session_points;
CREATE TRIGGER session_points_set_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON session_points
    FOR EACH ROW EXECUTE FUNCTION set_point_geom();

-- ---------------------------------------------------------------- per-hex distances
-- Server-computed, clipped at H3 cell boundaries (LLD Section 4.3).
-- Client-reported per-hex distances are preview only and never stored here.
CREATE TABLE IF NOT EXISTS session_hex_distances (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid      UUID NOT NULL REFERENCES walking_sessions (session_uuid) ON DELETE CASCADE,
    h3_index          BIGINT NOT NULL,
    valid_distance_m  NUMERIC NOT NULL CHECK (valid_distance_m >= 0),
    outcome           TEXT CHECK (outcome IS NULL OR outcome IN ('captured', 'challenged', 'refreshed', 'failed', 'ignored')),
    UNIQUE (session_uuid, h3_index)
);
CREATE INDEX IF NOT EXISTS session_hex_distances_session_idx ON session_hex_distances (session_uuid);
CREATE INDEX IF NOT EXISTS session_hex_distances_h3_idx ON session_hex_distances (h3_index);

-- ---------------------------------------------------------------- hex ownership
-- THE contested table. Read LLD Sections 1.6 and 4.4 before touching it.
CREATE TABLE IF NOT EXISTS hex_ownership (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index            BIGINT NOT NULL,
    owner_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    hex_score_m         NUMERIC NOT NULL CHECK (hex_score_m BETWEEN 100 AND 200),
    captured_at         TIMESTAMPTZ NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    locked_until        TIMESTAMPTZ NOT NULL,
    superseded_at       TIMESTAMPTZ,
    source_session_uuid UUID NOT NULL REFERENCES walking_sessions (session_uuid),
    centre_lat          DOUBLE PRECISION NOT NULL,
    centre_lon          DOUBLE PRECISION NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > captured_at),
    CHECK (locked_until > captured_at),
    CHECK (superseded_at IS NULL OR superseded_at >= captured_at)
);
COMMENT ON COLUMN hex_ownership.hex_score_m IS 'Capture distance capped at 200 m. Minimum 100 m because capture requires >= 100 m valid walk in the hex.';
COMMENT ON COLUMN hex_ownership.centre_lat IS 'Denormalised H3 cell centre, stored at insert time for bbox map queries (LLD Section 3). Centres never change for a fixed H3 index.';
COMMENT ON COLUMN hex_ownership.superseded_at IS 'NULL = live row. A row past expires_at is treated as neutral by every query (expires_at > now()) and flipped to superseded lazily inside the transaction that next touches the hex.';

-- Race guard: exactly one live (non-superseded) owner per hex.
-- Writers MUST flip expired rows to superseded in the same transaction
-- before inserting a new owner; otherwise this index correctly blocks them.
CREATE UNIQUE INDEX IF NOT EXISTS hex_live_owner_idx
    ON hex_ownership (h3_index)
    WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS hex_ownership_owner_expiry_idx
    ON hex_ownership (owner_id, expires_at);
CREATE INDEX IF NOT EXISTS hex_ownership_centre_idx
    ON hex_ownership (centre_lon, centre_lat);
CREATE INDEX IF NOT EXISTS hex_ownership_h3_idx
    ON hex_ownership (h3_index);

-- ---------------------------------------------------------------- XP ledger
-- Append-only. NEVER update or delete rows. Totals are SUM(xp).
CREATE TABLE IF NOT EXISTS xp_ledger (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_uuid UUID NOT NULL,
    entry_type   TEXT NOT NULL CHECK (entry_type IN ('walk', 'bonus')),
    xp           INTEGER NOT NULL CHECK (xp >= 0),
    week_start   DATE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_uuid, entry_type)
);
COMMENT ON TABLE xp_ledger IS 'One session has at most two rows: walk (FLOOR(total_valid_m / 100)) and bonus (50 per capture + 100 per challenge, aggregated). Per-hex breakdown lives in walking_sessions.evaluation_result, not here.';
COMMENT ON COLUMN xp_ledger.week_start IS 'Monday of the week containing created_at in Asia/Karachi, computed by application code.';

CREATE INDEX IF NOT EXISTS xp_ledger_week_user_idx ON xp_ledger (week_start, user_id);
CREATE INDEX IF NOT EXISTS xp_ledger_user_week_idx ON xp_ledger (user_id, week_start);

-- ---------------------------------------------------------------- flagged sessions
CREATE TABLE IF NOT EXISTS flagged_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid   UUID NOT NULL UNIQUE REFERENCES walking_sessions (session_uuid) ON DELETE CASCADE,
    reasons        JSONB NOT NULL,
    review_status  TEXT NOT NULL DEFAULT 'pending'
                   CHECK (review_status IN ('pending', 'approved', 'rejected')),
    reviewed_at    TIMESTAMPTZ,
    reviewed_by    UUID REFERENCES users (id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- background jobs
-- Simple jobs table, NOT Kafka/RabbitMQ (MVP decision, HLD Section 4).
CREATE TABLE IF NOT EXISTS jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type    TEXT NOT NULL CHECK (job_type IN ('evaluate_session', 'weekly_snapshot', 'housekeeping')),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_status_next_run_idx ON jobs (status, next_run_at);

COMMIT;
