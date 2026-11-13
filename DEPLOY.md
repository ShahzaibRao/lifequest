# Deploying LifeQuest

Run LifeQuest anywhere Docker runs. There are three ways, pick the one
that matches your setup. The backend is one Docker image
(`raoshahzaib/lifequest-api`) run as two containers — the **API** and the
**worker** — plus Postgres (PostGIS) and Redis.

> **TL;DR — just try it:**
> ```bash
> # 1. Get the compose file (or clone the whole repo)
> curl -O https://raw.githubusercontent.com/ShahzaibRao/lifequest/staging/backend/docker-compose.yml
> # 2. Start everything
> docker compose up -d
> # 3. Check it
> curl http://localhost:8000/api/v1/health
> #    -> {"status":"ok","app":"lifequest-api","version":"0.1.0"}
> ```
> No `.env` file needed for a first run — defaults are built in.
> Stop with `docker compose down` (your data stays in the `lifequest-data`
> volume; add `-v` only if you really want to delete the database).

---

## 1. Local run (laptop / any server)

**You need:** Docker + Docker Compose (Docker Desktop, or `docker` + the
`docker compose` plugin on Linux).

```bash
# Option A — just the compose file (fastest)
mkdir lifequest && cd lifequest
curl -O https://raw.githubusercontent.com/ShahzaibRao/lifequest/staging/backend/docker-compose.yml
docker compose up -d

# Option B — clone the repo (you also get the source + mobile app)
git clone https://github.com/ShahzaibRao/lifequest.git
cd lifequest/backend
docker compose up -d
```

**Check it:**
```bash
docker compose ps
#   lifequest-api      Up
#   lifequest-worker   Up
#   lifequest-db       Up (healthy)
#   lifequest-redis    Up (healthy)
curl http://localhost:8000/api/v1/health
```

**Use it:** the API is on `http://localhost:8000/api/v1`. Point the mobile
app at it (`EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000/api/v1`), or use
any API client. Register a user at `POST /api/v1/auth/register`.

**Update to a newer version:**
```bash
docker compose pull && docker compose up -d
```
This pulls the newest image from Docker Hub and restarts api + worker.
The database volume is untouched, so users and data stay.

**Change a setting** (port, password, image tag): copy the example env file
and edit it — see [Configuration](#2-configuration) below.

---

## 2. Configuration

All settings have defaults, so a `.env` file is optional. Create one only
when you want to change something.

```bash
cd lifequest/backend          # or wherever your docker-compose.yml is
cp .env.example .env
# edit .env in your editor
docker compose up -d
```

| Variable | Default | What it does |
|---|---|---|
| `IMAGE_TAG` | `latest` | Which Docker Hub image tag to run (`staging`, `latest`, `sha-<commit>`) |
| `API_PORT` | `8000` | Port on your machine for the API |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `lifequest` / `lifequest` / `lifequest` | Database login + database name |
| `DATABASE_URL` | `postgresql+psycopg://lifequest:lifequest@db:5432/lifequest` | Full DB URL for api + worker (if you change `POSTGRES_PASSWORD`, change this too) |
| `JWT_SECRET` | `dev-jwt-secret-change-me-in-production` | Signs login tokens — **change this in production** (`openssl rand -hex 32`) |
| `REDIS_URL` | `redis://redis:6379/0` | Only set this if Redis is not the compose `redis` service |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(none)* | Only for the home-lab tunnel (section 3) |

**Production warning:** the built-in password (`lifequest`) and JWT secret
are only for trying the app out. For real use, set a long random
`POSTGRES_PASSWORD` (+ matching `DATABASE_URL`) and a long random
`JWT_SECRET`. Never commit a real `.env` to git.

---

## 3. Home lab (own domain via Cloudflare Tunnel)

Use this when the server sits at home (no public IP) and you want the API
reachable on your own domain, e.g. `https://api.example.com`.

**1. Create the tunnel (Cloudflare dashboard, once):**
- Cloudflare dashboard -> Zero Trust -> Networks -> Tunnels -> Create.
- Name it (e.g. `lifequest`), copy the **token** it shows.
- Add a public hostname: subdomain `api`, domain your domain,
  service `http://api:8000` (the `api` service inside the compose network).

**2. Put the token in `.env`:**
```bash
cp .env.example .env
# set: CLOUDFLARE_TUNNEL_TOKEN=<the token you copied>
```

**3. Start with the `prod` profile** (this is the only difference — it
adds the tunnel container):
```bash
docker compose --profile prod up -d
docker compose ps        # lifequest-tunnel should be Up
curl https://api.example.com/api/v1/health
```

**Notes:**
- Without `--profile prod`, the tunnel never starts (good — local runs stay local).
- The tunnel only needs outbound internet; no port forwarding on your router.
- If you change the token, restart just the tunnel: `docker compose --profile prod restart cloudflared` (or `up -d` again).

---

## 4. Cloud container services (GCP / AWS / Oracle)

These platforms run **containers**, not Compose files — so you run the same
Docker Hub image there, and give it a managed database + Redis. The pattern
is identical on GCP Cloud Run, AWS ECS/Fargate, and Oracle Container
Instances; only the console clicks differ.

**What you need (one of each):**
1. **Postgres with PostGIS** — GCP Cloud SQL for PostgreSQL (enable the
   `postgis` extension), AWS RDS for PostgreSQL, or Oracle's managed
   Postgres. The app needs the `postgis` extension and the migrations run
   once (see below).
2. **Redis** — GCP Memorystore, AWS ElastiCache, or a small Redis container.
3. **Two containers from one image** `raoshahzaib/lifequest-api:latest`:
   - **API:** command `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2`, port `8000`.
   - **Worker:** command `python -m app.worker` (no public port).
4. **Environment variables** (same names as `.env.example`):
   `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`. Point `DATABASE_URL` at your
   managed Postgres and `REDIS_URL` at your managed Redis.

**Example — GCP Cloud Run (API):**
```bash
gcloud run deploy lifequest-api \
  --image raoshahzaib/lifequest-api:latest \
  --command "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2" \
  --port 8000 --allow-unauthenticated \
  --set-env-vars "DATABASE_URL=postgresql+psycopg://USER:PASS@HOST:5432/lifequest,JWT_SECRET=<long-random>,REDIS_URL=redis://HOST:6379/0"
# Worker: same image, same env vars, command "python -m app.worker",
# as a Cloud Run *job* or a second service with no public access.
```

**Migrations (once, after the database is created):**
The Docker image does not run migrations by itself. Run them once against
your database (from any machine that can reach it):
```bash
# from the repo, backend/migrations/*.sql in order 001..009
for f in backend/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```
(For a Compose run the same applies on first setup; the home-lab server
had its migrations run manually.)

**Which service for what:**
| Need | GCP | AWS | Oracle |
|---|---|---|---|
| API (public) | Cloud Run | ECS/Fargate + ALB | Container Instances + LB |
| Worker (no public port) | Cloud Run job | ECS/Fargate task | Container Instances |
| Postgres + PostGIS | Cloud SQL | RDS | OCI Database / Autonomous |
| Redis | Memorystore | ElastiCache | OCI Cache / Redis container |

The compose file is still useful there as the **reference** for the exact
image, commands, ports and env vars — copy the values from it into the
cloud console.

---

## 5. Staging vs production

- **Staging** (test a change): `IMAGE_TAG=staging docker compose up -d`.
  The `staging` image is built by CI from the `staging` branch.
- **Production** (real users): `IMAGE_TAG=latest` (default), or pin an exact
  build `IMAGE_TAG=sha-<commit>` so you can roll back by pulling the older tag.
- **Flow:** fix on `staging` -> CI builds + scans -> merge `staging` into
  `main` -> CI builds `latest` -> `docker compose pull && docker compose up -d`
  on the server.
