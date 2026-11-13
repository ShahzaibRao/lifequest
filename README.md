# LifeQuest — Walk More. Capture More. Live Better.

Social health & fitness app: health tracking (water, food, sleep, exercise),
rule-based AI insights, GPS hexagonal territory capture, friends, challenges,
leaderboards, XP / levels / achievements. Free + Premium.

**Stack:** Expo / React Native (one codebase, iOS + Android) · FastAPI ·
PostgreSQL + PostGIS · Redis · Docker · Cloudflare Tunnel · GitHub Actions ·
EAS Build / EAS Update (OTA).

> **Rulebook is the authority.** Territory / XP / anti-cheat rules are locked in
> `territory-rulebook-v1.md` (in the workspace, not this repo). Rulebook > HLD > LLD.

## Repo layout

```
lifequest/
├── backend/            # FastAPI API + worker
│   ├── app/            # routers, models, services, core
│   ├── migrations/     # plain-SQL migrations 001–009
│   ├── Dockerfile      # distroless python3.13
│   └── docker-compose.yml
├── mobile/             # Expo / React Native app (SDK 58)
│   ├── src/            # api, auth, screens, walk, sync, map, i18n, health, cache
│   ├── app.json        # LifeQuest, com.raoshahzaib.lifequest, slug "mobile"
│   └── eas.json        # build profiles: development / preview / production
├── .github/workflows/  # ci.yml, codeql.yml
└── DEPLOY.md           # full deploy guide
```

## Environments

| | Staging | Production |
|---|---|---|
| Where | **Home lab server** (Tailscale `100.120.155.67`, folder `/home/eilaf/lifequest-staging/`) | **Oracle Cloud Kubernetes** (being built — main users go here) |
| API | `https://api.raoshahzaib.site/api/v1` (Cloudflare Tunnel) | TBD |
| Image | `raoshahzaib/lifequest-api:staging` | `raoshahzaib/lifequest-api:latest` |
| Branch | `staging` | `main` |

**Flow:** fix on `staging` → CI test + build → deploy to home lab, test on phone →
merge `staging` → `main` → production deploy (Oracle K8s).

## Local development

```bash
# backend (WSL or any machine with Docker)
cd backend && docker compose up -d
curl http://localhost:8000/api/v1/health   # {"status":"ok",...}

# mobile
cd mobile && npx expo start             # Metro on :8081
```

- API runs uvicorn with **2 workers, `--reload` OFF** — restart after code
  changes: `docker compose restart api`. Worker has no auto-reload either.
- **JS/TS-only changes need NO build** — press `r` in Metro to reload.
  A build is needed **only** for native changes: new native module, `app.json`
  change, new permission.
- `EXPO_PUBLIC_API_URL` already ends in `/api/v1` — screen paths are prefix-less.
- Dev build **cannot work offline** (it loads JS from Metro). Offline tests
  need a standalone preview APK. Phone + dev machine must be on the same Wi-Fi.
- Never hardcode passwords/secrets. JWT secret comes from env.

## Deploying staging (home lab)

```bash
# on the server (100.120.155.67, /home/eilaf/lifequest-staging)
docker compose pull && docker compose --profile prod up -d
# migrations run once per fresh DB: for f in migrations/*.sql; do ... done
curl https://api.raoshahzaib.site/api/v1/health
```

Full guide: [DEPLOY.md](DEPLOY.md). The tunnel runs only under the `prod`
profile. The image is pulled from Docker Hub — no build on the server.

## CI/CD

`.github/workflows/ci.yml` runs on push to `staging` / `main` and PRs to `main`:

1. `backend-check` — pip install + compileall
2. `mobile-check` — npm ci + tsc
3. `build-push` — builds + pushes `raoshahzaib/lifequest-api`
   (`:staging` from `staging`, `:latest` + `sha-*` from `main`)
4. `trivy-scan` — blocks on CRITICAL only (HIGH reported in the log)
5. `smoke-test` — the pushed image must start and answer `/health`

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`. **Runners: GitHub-hosted only.**

## OTA updates (EAS Update)

JS/TS fixes reach users **without a new APK**. Native changes still need a build.

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://api.raoshahzaib.site/api/v1 eas update --branch preview --message "what changed"
# select environment: preview
```

> **Gotcha:** `eas update` run locally picks up the local `.env` (staging URL).
> Always force the production URL on the command line as above.

## Auth & offline-first

- **WhatsApp-style login:** log in once, stay logged in until explicit logout.
  Tokens live in SecureStore. The app **never clears tokens on a network error**
  — only when the server rejects the refresh (401/403). A cached profile from
  SQLite opens the app offline.
- **Offline-first ("Phone pehle, server baad mein"):** health logs, walks and
  exercise save to on-device SQLite first and sync oldest-first on reconnect.
  Read screens show the last-synced cache with a "Cached" label. Only fresh
  hex ownership, live dots, friend/challenge sends, first login and push need
  the server.
- **Live dots are friends-only.** No walk-required tests — verify via scripts /
  simulation only.

## Locked rules (summary)

- H3 resolution 9. Capture ≥ 100 m valid walk in a hex in one session.
  Ownership 7 days, hex score capped at 200 m. Challenge wins only if the
  challenger's single-session valid distance **strictly exceeds** the owner's
  score. 24-hour transfer lock, checked first.
- XP: 1 per 100 m valid walk, capture +50, territory challenge +100.
  Weekly leaderboard reset Monday 00:00 PKT.
- Anti-cheat: valid speed 0.5–12 km/h, GPS accuracy ≤ 25 m, jump checks.
  GPS-vs-steps is a flag band only. Suspicious sessions are held for review,
  never auto-awarded.
- Walk only in MVP. Run deferred, cycling out. Indoor/treadmill = steps only.
- Insights are **view-only**; all actions live in Health. No LLM in Phase 1 —
  insights are rule-based, with a fixed non-medical disclaimer.
- Sleep is logged in **hours** in the UI; the server stores minutes.

## Test accounts

Password `0123456789` for all: `rao@testmail.com` (Rao, admin),
`ayesha.test@testmail.com`, `bilal.test@testmail.com`, `fatima.test@testmail.com`,
`usman.test@testmail.com`. Load-test accounts `load01@testmail.com`… use
`LoadTest0123456789`.
