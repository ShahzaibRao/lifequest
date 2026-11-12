-- 006_map_index.sql
-- Index for the map bbox query: GET /territories/map filters live hexes
-- by centre_lon / centre_lat (SQL bbox filter), so the map needs an
-- index on the centre coordinates.
--
-- Reconstructed 2026-11-07 during the backend recovery (the original
-- 006 file was lost with ~/lifequest/backend). The index name and
-- columns are from the live diagnostic (idx_hex_ownership_centre on
-- centre_lon, centre_lat).
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/006_map_index.sql

CREATE INDEX IF NOT EXISTS idx_hex_ownership_centre
    ON hex_ownership (centre_lon, centre_lat);
