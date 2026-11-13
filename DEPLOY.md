# Deploying LifeQuest

Run LifeQuest anywhere Docker runs. The backend is one Docker image
(`raoshahzaib/lifequest-api`) run as two containers — the **API** and the
**worker** — plus Postgres (PostGIS) and Redis.

> **TL;DR — just try it:**
> ```bash
> curl -O https://raw.githubusercontent.com/ShahzaibRao/lifequest/staging/backend/docker-compose.yml
> docker compose up -d
> curl http://localhost:8000/api/v1/health
> #    -> {"status":"ok","app":"lifequest-api","version":"0.1.0"}
> ```
> No `.env` file needed for a first run — defaults are built in.
> Stop with `docker compose down` (data stays in the `lifequest-data`
> volume; add `-v` only if you really want to delete the database).

## 1. Local run

**You need:** Docker + Docker Compose.

```bash
# just the compose file (fastest)
mkdir lifequest && cd lifequest
curl -O https://raw.githubusercontent.com/ShahzaibRao/lifequest/staging/backend/docker-compose.yml
docker compose up -d

# or clone the repo (you also get the source + mobile app)
git clone https://github.com/ShahzaibRao/lifequest.git
cd lifequest/backend && docker compose up -d
```

**Check it:** `docker compose ps` (api, worker, db healthy, redis healthy),
then `curl http://localhost:8000/api/v1/health`.

**Use it:** the API is on `http://localhost:8000/api/v1`. Register a user at
`POST /api/v1/auth/register`. Point the mobile app at it
(`EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000/api/v1`).

**Update:** `docker compose pull && docker compose up -d` — pulls the newest
image, restarts api + worker, database volume untouched.

## 2. Configuration

All settings have defaults, so a `.env` file is optional. Create one only
when you want to change something (`cp .env.example .env`, edit, `up -d`).

| Variable | Default | What it does |
|---|---|---|
| `IMAGE_TAG` | `latest` | Image tag: `staging`, `latest`, `sha-<commit>` |
| `API_PORT` | `8000` | Port on your machine for the API |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `lifequest` / `lifequest` / `lifequest` | Database login + name |
| `DATABASE_URL` | `postgresql+psycopg://lifequest:lifequest@db:5432/lifequest` | Full DB URL (change `POSTGRES_PASSWORD` here too) |
| `JWT_SECRET` | `dev-jwt-secret-change-me-in-production` | Signs login tokens — **change in production** (`openssl rand -hex 32`) |
| `REDIS_URL` | `redis://redis:6379/0` | Only if Redis is not the compose `redis` service |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(none)* | Only for the home-lab tunnel (section 3) |

**Production warning:** the built-in password (`lifequest`) and JWT secret
are only for trying the app out. For real use, set a long random
`POSTGRES_PASSWORD` (+ matching `DATABASE_URL`) and a long random
`JWT_SECRET`. Never commit a real `.env` to git.

**Migrations:** the image does not run migrations by itself. On a fresh
database, run them once in order:
```bash
for f in backend/migrations/*.sql; do
  docker compose exec -T db psql -U lifequest -d lifequest < "$f"
done
```

## 3. Staging — home lab (Cloudflare Tunnel)

The staging server sits at home (no public IP) and is reachable on its own
domain, e.g. `https://api.raoshahzaib.site`.

**1. Create the tunnel (Cloudflare dashboard, once):** Zero Trust → Networks →
Tunnels → Create. Copy the **token**. Add a public hostname: subdomain `api`,
service `http://api:8000` (the `api` service inside the compose network).

**2. Put the token in `.env`:** `CLOUDFLARE_TUNNEL_TOKEN=<token>`.

**3. Start with the `prod` profile** (the only difference — it adds the tunnel):
```bash
docker compose --profile prod up -d
docker compose ps        # lifequest-tunnel should be Up
curl https://api.raoshahzaib.site/api/v1/health
```

Without `--profile prod` the tunnel never starts (good — local runs stay local).
The tunnel only needs outbound internet; no port forwarding on the router.

## 4. Production — Oracle Cloud Kubernetes (coming)

Production will run on an Oracle Cloud Kubernetes cluster (being built).
Main users go there. The pattern:

1. **Postgres with PostGIS** — OCI managed Postgres (enable the `postgis`
   extension), or Postgres in the cluster. Run migrations 001–009 once.
2. **Redis** — OCI Cache / a small Redis container in the cluster.
3. **Two containers from one image** `raoshahzaib/lifequest-api:latest`:
   - **API:** command `-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2`, port `8000`.
   - **Worker:** command `-m app.worker` (no public port).
4. **Env vars** (same names as `.env.example`): `DATABASE_URL`, `JWT_SECRET`,
   `REDIS_URL`. Secrets live in OCI Vault, delivered via ExternalSecrets —
   never hardcoded in manifests.

The compose file is the **reference** for the exact image, commands, ports
and env vars — copy the values from it into the Kubernetes manifests.

## 5. Staging vs production

- **Staging** (test a change): `IMAGE_TAG=staging`, branch `staging`,
  deployed on the home lab. The `staging` image is built by CI from `staging`.
- **Production** (real users): `IMAGE_TAG=latest` (default), or pin an exact
  build `IMAGE_TAG=sha-<commit>` to roll back by pulling the older tag.
- **Flow:** fix on `staging` → CI builds + scans → deploy + test on home lab →
  merge `staging` into `main` → CI builds `latest` → deploy to Oracle K8s.
