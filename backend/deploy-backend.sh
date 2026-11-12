#!/usr/bin/env bash
# LifeQuest backend — deploy on the home Ubuntu server.
# Run from ~/lifequest/backend/ AFTER copying the backend code here.
# Creates a fresh production .env (new JWT secret + DB password) the
# first time, then starts the stack (api + db + worker + redis + tunnel).
# Safe to re-run (won't overwrite .env).
set -euo pipefail
cd ~/lifequest/backend

if [ ! -f .env ]; then
  echo "== creating fresh production .env =="
  JWT_SECRET=$(openssl rand -hex 32)
  DB_PASS=$(openssl rand -hex 16)
  cat > .env <<EOF
# LifeQuest production (home server) — generated $(date -u +%F)
POSTGRES_USER=lifequest
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=lifequest
DATABASE_URL=postgresql+psycopg2://lifequest:${DB_PASS}@db:5432/lifequest
JWT_SECRET=${JWT_SECRET}
REDIS_URL=redis://redis:6379/0
# Cloudflare Tunnel token (from Zero Trust dashboard -> Networks -> Tunnels).
# Fill this in, then re-run this script to start the tunnel container.
CLOUDFLARE_TUNNEL_TOKEN=
EOF
  chmod 600 .env
  echo ".env created (fresh JWT secret + DB password)."
else
  echo ".env already exists — keeping it (delete it to regenerate)."
fi

if ! grep -q "^CLOUDFLARE_TUNNEL_TOKEN=.\+" .env 2>/dev/null; then
  echo "NOTE: CLOUDFLARE_TUNNEL_TOKEN is empty in .env — the tunnel container will fail to start."
  echo "Create the tunnel in Cloudflare Zero Trust dashboard, copy its token into .env, then re-run this script."
fi

echo "== docker compose up =="
docker compose --profile prod up -d --build

echo "== running migrations (fresh DB) =="
for f in migrations/*.sql; do
  echo "  -- $f"
  docker compose exec -T db psql -P pager=off -U lifequest -d lifequest -v ON_ERROR_STOP=1 < "$f" || echo "  !! FAILED: $f"
done
docker compose restart api >/dev/null 2>&1

echo "== waiting for API =="
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/v1/health >/dev/null 2>&1; then
    echo "API is up: $(curl -s http://localhost:8000/api/v1/health)"
    echo "Tunnel: docker compose logs cloudflared --tail 20"
    exit 0
  fi
  sleep 2
done
echo "API did not come up in 60s. Check: docker compose ps && docker compose logs api --tail 50"
exit 1

