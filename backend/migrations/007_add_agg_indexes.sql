-- 007_add_agg_indexes.sql
-- Indexes for the hot aggregation queries (leaderboard / profile / insights)
-- plus the login email lookup. All IF NOT EXISTS, so re-running is safe.
--
-- NO BEGIN/COMMIT wrapper (deliberate): each CREATE INDEX is its own
-- transaction, so one wrong table name cannot roll back the good ones
-- (v1 used a single transaction and a bad name rolled back all 7).
--
-- Why each one (from the live endpoint code, 2026-11-07):
--  xp_ledger (week_start, user_id, xp): leaderboard weekly SUM + GROUP BY.
--    Covering (index-only scan): the query needs only these 3 columns.
--  xp_ledger (user_id, xp): profile total_xp SUM WHERE user_id = ? (covering).
--  hex_ownership (owner_id, superseded_at): profile territories_count +
--    insights live-territory list (both filter owner + live rows).
--  health_logs (user_id, logged_date): insights weekly sleep/logs range.
--  walking_sessions (user_id, started_at): insights loads a user's sessions.
--  user_achievements (user_id): profile achievements_count.
--  users (email): login lookup by email.
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/007_add_agg_indexes.sql

CREATE INDEX IF NOT EXISTS idx_xp_ledger_week_user_xp ON xp_ledger (week_start, user_id, xp);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_xp ON xp_ledger (user_id, xp);
CREATE INDEX IF NOT EXISTS idx_hex_ownership_owner_live ON hex_ownership (owner_id, superseded_at);
CREATE INDEX IF NOT EXISTS idx_health_logs_user_date ON health_logs (user_id, logged_date);
CREATE INDEX IF NOT EXISTS idx_walking_sessions_user_started ON walking_sessions (user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
