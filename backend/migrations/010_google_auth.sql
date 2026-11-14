-- 010: Google OAuth — passwords removed, google_sub added.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN google_sub VARCHAR UNIQUE;
