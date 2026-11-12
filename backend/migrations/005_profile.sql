-- 005_profile.sql
-- Profile fields on users: city, bio, avatar_key (20 backend-owned
-- avatar presets; display_name is deliberately non-unique, identity is
-- avatar + city + profile).
--
-- Reconstructed 2026-11-07 during the backend recovery (the original
-- 005 file was lost with ~/lifequest/backend). The columns are taken
-- from app/models/user.py (User: city Text, bio Text, avatar_key String,
-- all nullable).
--
-- Apply from ~/lifequest/backend:
--   docker compose exec -T db psql -U lifequest -d lifequest < migrations/005_profile.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key VARCHAR;
