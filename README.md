# LifeQuest — Walk More. Capture More. Live Better.

Social health & fitness app: health tracking (water, food, sleep, exercise),
rule-based AI insights, GPS hexagonal territory capture, friends, challenges,
leaderboards, XP / levels / achievements. Free + Premium.

**Stack:** Expo / React Native (one codebase, iOS + Android) · FastAPI ·
PostgreSQL + PostGIS · Redis · Docker · Cloudflare Tunnel · GitHub Actions ·
EAS Build / EAS Update (OTA).

> **Rulebook is the authority.** Territory / XP / anti-cheat rules are locked in
> `territory-rulebook-v1.md` (in the workspace, not this repo). Rulebook > HLD > LLD.

---

## Repo layout

```
lifequest/
├── backend/            # FastAPI API + worker (Docker Compose)
│   ├── app/            # routers, models, services, core
│   ├── migrations/     # plain-SQL migrations 001–009
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── deploy-backend.sh
├── mobile/             # Expo / React Native app (SDK 58)
│   ├── src/            # api, auth, screens, walk, sync, map, i18n, health, cache
│   ├── app.json        # name LifeQuest, package com.raoshahzaib.lifequest, slug "mobile"
│   └── eas.json        # build profiles: development / preview / production
├── .github/workflows/ci.yml
└── README.md
```

---

## Environments

| | Staging | Production |
|---|---|---|
| Where | WSL dev stack on the dev machine (`~/lifequest/`) | Home Ubuntu server `192.168.2.105`, user `eilaf` |
| API | `http://192.168.5.100:8000/api/v1` (LAN, via portproxy → WSL) | `https://api.raoshahzaib.site/api/v1` (Cloudflare Tunnel) |
| Containers | api, db, worker, redis (no tunnel) | api, db, worker, redis, cloudflared tunnel |
| Branch | `staging` | `main` |
| Mobile | Expo dev build + Metro | Standalone preview / production APK |

**One compose file.** The tunnel runs only under the `prod` profile:

```bash
# staging (WSL)
cd ~/lifequest/backend && docker compose up -d

# production (home server)
cd ~/lifequest/backend && docker compose --profile prod up -d
```

**Backend code lives in tarballs and is extracted to `~/lifequest/backend/`
— that directory can be deleted. Always `ls` to verify it exists before working.**

**WSL networking (reboot ritual):** Windows → WSL IP TCP is broken. Use
portproxy `v4tov6` → IPv6 localhost `::1` for ports 8000 + 8081, never the WSL
IP. Never use mirrored networking (Windows 10 build 19045 does not support it).

---

## Local development (staging)

### Backend

```bash
cd ~/lifequest/backend
docker compose up -d
docker compose ps
# health: GET http://localhost:8000/api/v1/health -> {"status":"ok","app":"lifequest-api","version":"0.1.0"}
```

- API runs uvicorn with **2 workers, `--reload` OFF** — restart the container
  after code changes: `docker compose restart api`.
- Worker (`python -m app.worker`) has **no auto-reload** — restart after changes.
- Migrations are plain SQL; `deploy-backend.sh` runs them after `compose up`.
- Never hardcode passwords/secrets. Secrets live in OCI Vault / `.env`, delivered
  via ExternalSecrets. JWT secret comes from env.

### Mobile

```bash
cd ~/lifequest/mobile
npx expo start        # Metro on :8081
```

- `EXPO_PUBLIC_API_URL` already ends in `/api/v1` — screen paths are prefix-less.
- **JS/TS-only changes need NO build** — press `r` in Metro to reload.
- A build is needed **only** for native changes: new native module, `app.json`
  change, new permission.
- Dev build **cannot work offline** (it loads its JS bundle from Metro).
  Offline behaviour is tested on a standalone preview APK, not the dev build.
- The phone and the Windows machine must be on the **same Wi-Fi**.

---

## Production deployment

Production is the home server (`192.168.2.105`) behind a Cloudflare Tunnel
(`api.raoshahzaib.site`). There is no public IP, so GitHub-hosted runners
cannot SSH it — deployment is pull-based / manual from the server.

```bash
# on the server (~/lifequest/backend)
./deploy-backend.sh    # compose --profile prod up, runs migrations, health-checks /api/v1/health
```

- Fresh production DB has **no tables** — the Dockerfile never runs migrations;
  `deploy-backend.sh` runs them after `compose up`.
- EAS preview APK: `eas build --profile preview --platform android`.
  `app.json` is `LifeQuest` (package `com.raoshahzaib.lifequest`); the **slug
  stays `mobile`** because the EAS projectId is registered under it.
- Preview profile bakes `EXPO_PUBLIC_API_URL=https://api.raoshahzaib.site/api/v1`
  — no manual address entry in the app.

---

## CI/CD

`.github/workflows/ci.yml` runs on push to `staging` / `main` and on PRs to `main`:

1. `backend-check` — pip install + `python -m compileall backend/app`
2. `mobile-check` — `npm ci` + `npx tsc --noEmit`
3. `build-push` — builds the backend image and pushes it to Docker Hub
   (`raoshahzaib/lifequest-api:staging` from `staging`, `latest` + `sha-*` from `main`)

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`. The image name is **hardcoded**
as `raoshahzaib/lifequest-api` in `ci.yml` (the username secret carries a trailing
newline that broke tag generation).

**Runners: GitHub-hosted only — no self-hosted runner.** Production deploy
mechanism (server-pull vs Tunnel-SSH) is still to be decided.

**Branch flow:** fix on `staging` → CI test + build → WSL staging test →
merge `staging` → `main` → production deploy.

---

## OTA updates (EAS Update)

JS/TS fixes reach users **without a new APK**. Native changes still need a build.

- `expo-updates` is installed; `app.json` has
  `updates.url: https://u.expo.dev/7407bf0a-4b3f-45ab-b15a-735f37adbab9`.
- `src/updates/useAppUpdate.ts` checks for an update on app launch (only when
  logged in). If one is available it downloads in the background and shows
  **"Naya update available"** — tapping **"Update karein"** restarts the app
  on the new code. Silent when offline or when no update exists.
- Publish an update:

```bash
cd ~/lifequest/mobile
EXPO_PUBLIC_API_URL=https://api.raoshahzaib.site/api/v1 eas update --branch preview --message "what changed"
# select environment: preview
```

> **Gotcha:** `eas update` run locally picks up the local `.env` (staging URL
> `http://192.168.5.100:8000`). Always force the production URL on the command
> line as above, or the published update will point the app at the staging
> server and it will fall back to cached/offline mode.

---

## Auth & offline-first

- **WhatsApp-style login:** log in once, stay logged in until explicit logout.
  Tokens live in SecureStore. The app **never clears tokens on a network error**
  — only when the server rejects the refresh (401/403). A cached profile from
  SQLite opens the app offline; it re-validates in the background when online.
- **Offline-first ("Phone pehle, server baad mein"):** health logs, walks and
  exercise are saved to on-device SQLite first and synced oldest-first on
  reconnect. Read screens (Profile, Achievements, Friends, Leaderboard,
  Challenges, Map hexes) show the last-synced cache with a "Cached" label.
  Only fresh hex ownership, live dots, friend/challenge sends, first login and
  push need the server.
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
