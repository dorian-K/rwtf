# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RWTF tracks utilization of RWTH Aachen University facilities. It has two data domains:

- **Gym occupancy** — scraped from the gym booking page via image OCR, stored in MariaDB, predicted from historical analysis, and shown as an interactive dashboard.
- **Campus WiFi** — crowdsourced access-point scans (from the `RWTFWifiScanner` Android app) are turned into per-building device counts and predictions.

Also included: study-material search/download (RWTH-IP-gated) and an experimental offline PyTorch predictor (`ai/`).

## Development Commands

**Full stack (dev mode):**
```bash
# Terminal 1 — backend + DB + nginx via Docker
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build

# Terminal 2 — Next.js dev server (proxied through nginx on port 80)
cd webapp && npm run dev
```
The webapp is served on port **80** (nginx); open http://localhost/.

**Frontend only (`webapp/`):**
```bash
npm run dev       # dev server
npm run build     # static export to webapp/out/
npm run lint      # ESLint (eslint .)
```

**Backend only (`server/`):**
```bash
npm run build              # tsc → dist/
npm start                  # tsc + node dist/src/index.js (port 4000)
npm run start-without-build
npm run test               # runs OCR digit-labeling test (test/test_label_images.ts)
```

**Android scanner (`RWTFWifiScanner/`):** Gradle project — `./gradlew build`, `./gradlew test`.

**AI experiment (`ai/`):** standalone PyTorch scripts — `python -m ai.main`. Not part of the Docker runtime.

## Architecture

Docker Compose runs four services (see `docker-compose.yml`; `.debug.yml` overrides for local dev):

- **`rwtf_nginx`** — reverse proxy. Routes `/api/*` → `server:4000`, `/embed_picture.png` → the screenshot volume, everything else → the static webapp volume (`nginx.conf` / `nginx.debug.conf`).
- **`server/`** — Express.js API (port 4000). Crawls the gym page every 5 min (`gym_crawler.ts`, OCR via canvas/sharp), ingests WiFi AP uploads, serves REST endpoints, and auto-creates the DB schema on startup.
- **`mariadb`** — data store.
- **`screenshot/`** — Puppeteer service (cron-driven) that captures the gym booking page as the input to the OCR pipeline.

The **`webapp/`** static export is built into a Docker volume that nginx serves — it is not a running service in production.

## Key Files

**Backend (`server/src/`):**
- `index.ts` — all API routes **and** DB schema init. Tables: `rwth_gym` (id, `auslastung` 0–100, created_at), `studyfiles`, `wifi_data`, `wifi_data_apnames`, `wifi_data_aplocations`.
- `gym_crawler.ts` — OCR scraper; diffs the screenshot against synthetic digit images.
- `prediction.ts` — **generic** time-series day-prediction engine (`closest` / `average` / `median` / `dayofweek`), shared by gym and WiFi. Domain-agnostic: operates on `{ value, created_at }` with a configurable `DayWindow` (gym 06:00–24:00, WiFi full 24 h). Weights the last ~120 weeks.
- `study.ts` — study-file search, inspect, and streaming download; RWTH-IP gate (`isAachener`).
- `sample_data.ts` — canned gym data served when the DB is empty/unavailable.
- `db.ts` — MariaDB pool. Host is hardcoded `mariadb`; `.debug.yml` maps this to localhost for local dev.

**Key API routes** (`/api/v1/...`): `gym`, `gym_interpline`, `gym/export`, `gym/history`, `gym/monthly`, `gym/hourly-pattern`, `wifiap` (POST, ingest), `wifi/buildings`, `wifi/building`, `wifi/building_predict`, `study`, `study/search`, `study/inspect`, `is_aachen`, `upload`.

**Frontend (`webapp/src/`):**
- `pages/index.tsx` — main dashboard (live gym chart, study materials, data export).
- `pages/trends.tsx` — historical trends: heatmap + monthly aggregates.
- `pages/wifi.tsx` — per-building WiFi device counts + predictions.
- `pages/embed_gym.tsx` — embeddable iframe widget.
- `api/Backend.ts` — all backend API call wrappers.
- `components/BackendProvider.tsx` — React context provider; consumed via `useBackendContext()`.

**Android (`RWTFWifiScanner/`):** Kotlin foreground `MappingService` scans WiFi APs + GPS and POSTs batches to `/api/v1/wifiap` (`RwtfApiService`, payload `RwtfUploadPayload`/`ApEntry`). Room DB caches locally.

**AI (`ai/`):** experimental decoder-only Transformer (`model.py`) trained offline on gym history (`main.py`, `data.py`) — a research alternative to `prediction.ts`, not wired into the live stack.

## Important Constraints

- **Static export**: Next.js has `output: 'export'` — no `getServerSideProps`, no API routes, no dynamic rendering. All data fetching is client-side.
- **WiFi ingest auth**: `POST /api/v1/wifiap` requires `?token=` matching `WIFIAP_TOKEN` env var and `version === 1`; body limited to 500 kb.
- **Rate limiting**: most endpoints burst at 20 req/5s; study streaming and data export have stricter per-IP limiters. Don't remove them.
- **Data export limits**: capped at 31 days / 10k rows per request; `Content-Disposition` filename is sanitized. Keep these guards.
- **Geo-IP check**: study materials are restricted to RWTH IP ranges (`/api/v1/is_aachen`, `isAachener`). Intentional.
- **DB schema**: auto-initialized in `index.ts` on server start — add new tables there.
- **Path alias**: `@/*` maps to `webapp/src/*` (`tsconfig.json` + Next config).
- **Code style**: 4-space indentation, 100-char line width (`.prettierrc` in both `webapp/` and `server/`).
