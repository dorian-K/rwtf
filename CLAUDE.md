# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RWTF is a gym utilization tracker for RWTH Aachen University. It scrapes occupancy data via OCR, predicts future utilization using historical analysis, and presents it as an interactive dashboard.

## Development Commands

**Full stack (dev mode):**
```bash
# Terminal 1 — backend + DB + nginx via Docker
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build

# Terminal 2 — Next.js dev server (proxied through nginx on port 80)
cd webapp && npm run dev
```

**Frontend only:**
```bash
cd webapp
npm run dev       # dev server
npm run build     # static export to webapp/out/
npm run lint      # ESLint check
```

**Backend only:**
```bash
cd server
npm run build     # tsc → dist/
npm start         # build + run on port 4000
npm run test      # OCR image test
```

## Architecture

Three services orchestrated by Docker Compose:

- **`server/`** — Express.js API (port 4000). Crawls gym page every 5 min via `gym_crawler.ts` (image OCR with canvas/sharp), stores readings in MariaDB, serves REST endpoints.
- **`webapp/`** — Next.js 16 frontend, configured as **static export** (`output: 'export'`). No SSR — all pages are pre-rendered HTML with client-side data fetching. Served by nginx from a Docker volume.
- **`screenshot/`** — Puppeteer-based service that captures the gym booking page for the OCR pipeline.

Nginx reverse proxies `/api/*` to the server and serves the static webapp for everything else.

## Key Files

**Backend (`server/src/`):**
- `index.ts` — All API routes + DB init (schema auto-created on start)
- `gym_crawler.ts` — OCR-based scraper; uses image diff against synthetic digit images
- `gym_math.ts` — 4 prediction methods: `closest`, `average`, `median`, `dayofweek`. Analyzes last 120 weeks with weighted scoring.
- `db.ts` — MariaDB connection pool (host `mariadb` in Docker, `localhost` in debug)

**Frontend (`webapp/src/`):**
- `pages/index.tsx` — Main dashboard: live gym chart, study materials, data export
- `pages/trends.tsx` — Historical trends with heatmap and monthly aggregates
- `pages/embed_gym.tsx` — Embeddable iframe widget
- `context/BackendContext.tsx` — React context wrapping all API calls; consumed via `useBackend()`

## Important Constraints

- **Static export**: Next.js has `output: 'export'` — no `getServerSideProps`, no API routes, no dynamic rendering. All data fetching must be client-side.
- **Rate limiting**: Most endpoints burst at 20 req/5s; study file streaming and data export have stricter per-IP limits. Don't remove rate limiters.
- **Data export limits**: Capped at 31 days / 10k rows per request; `Content-Disposition` filename is sanitized. Keep these guards in place.
- **Geo-IP check**: Study materials are restricted to RWTH IP ranges (`/api/v1/is_aachen`). This is intentional.
- **DB schema**: Auto-initialized in `index.ts` on server start. Main table is `rwth_gym` with columns `id`, `auslastung` (0–100), `created_at`.
- **Path alias**: `@/*` maps to `webapp/src/*` in TypeScript and Next.js config.
- **Code style**: 4-space indentation, 100-char line width (`.prettierrc` in both `webapp/` and `server/`).
