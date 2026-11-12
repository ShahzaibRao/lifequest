"""docker-compose: production hardening + Cloudflare Tunnel container (2026-11-09).

- Adds a cloudflared service (tunnel runs as a container, same Docker
  network, reaches the API as http://api:8000 — no host install, no
  systemd service). Token comes from CLOUDFLARE_TUNNEL_TOKEN in .env.
- restart: unless-stopped on every service (survives server reboot).
- db + redis ports bound to localhost only (not exposed on the LAN).
Run this patch on the SERVER copy (~/lifequest/backend/docker-compose.yml).
"""

from pathlib import Path

p = Path("~/lifequest/backend/docker-compose.yml").expanduser()
s = p.read_text()
orig = s


def rep(old, new, label):
    global s
    if new and new in s:
        print(f"SKIP (already applied): {label}")
        return True
    n = s.count(old)
    if n == 1:
        s = s.replace(old, new)
        print(f"OK: {label}")
        return True
    print(f"PARTIAL: {label} (found {n}, expected 1)")
    return False


rep(
    """# LifeQuest — local development (recovered 2026-11-07).
# Services: api (FastAPI, 2 uvicorn workers), db (PostGIS), worker
# (background evaluation jobs), redis (read cache + live dots).""",
    """# LifeQuest — production (home Ubuntu server).
# Services: api (FastAPI, 2 uvicorn workers), db (PostGIS), worker
# (background evaluation jobs), redis (read cache + live dots),
# cloudflared (Cloudflare Tunnel -> api.raoshahzaib.site).""",
    "header comment",
)

rep(
    """  api:
    build: .
    container_name: lifequest-api""",
    """  api:
    build: .
    container_name: lifequest-api
    restart: unless-stopped""",
    "api restart",
)

rep(
    """  db:
    image: postgis/postgis:16-3.4
    container_name: lifequest-db""",
    """  db:
    image: postgis/postgis:16-3.4
    container_name: lifequest-db
    restart: unless-stopped""",
    "db restart",
)

rep(
    """    ports:
      - "5432:5432\"""",
    """    ports:
      - "127.0.0.1:5432:5432\"""",
    "db localhost only",
)

rep(
    """  worker:
    build: .
    container_name: lifequest-worker""",
    """  worker:
    build: .
    container_name: lifequest-worker
    restart: unless-stopped""",
    "worker restart",
)

rep(
    """  redis:
    image: redis:7-alpine
    container_name: lifequest-redis
    ports:
      - "6379:6379\"""",
    """  redis:
    image: redis:7-alpine
    container_name: lifequest-redis
    restart: unless-stopped
    ports:
      - "127.0.0.1:6379:6379\"""",
    "redis restart + localhost only",
)

rep(
    """    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:""",
    """    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 12
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: lifequest-tunnel
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      api:
        condition: service_started
    restart: unless-stopped

volumes:""",
    "cloudflared service",
)

if s != orig:
    p.write_text(s)
    print("done -- then: cd ~/lifequest/backend && docker compose up -d")
else:
    print("done -- no changes (already applied)")
