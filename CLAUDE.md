# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RWTF tracks utilization of RWTH Aachen University facilities. It has two data domains:

- **Gym occupancy** — scraped from the gym booking page via image OCR, stored in MariaDB, predicted from historical analysis, and shown as an interactive dashboard.
- **Campus WiFi** — per-access-point user counts scraped from the RWTH NOC portal (`wifiap-client/`), aggregated into per-building device counts and predictions. The `RWTFWifiScanner` Android app separately crowdsources AP locations (scans + GPS).

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
npm run lint      # Biome lint + format check (biome check .)
npm run format    # Biome autofix + format
```

**Backend only (`server/`):**
```bash
npm run build              # tsc → dist/
npm start                  # tsc + node dist/src/index.js (port 4000)
npm run start-without-build
npm run test               # runs OCR digit-labeling test (test/test_label_images.ts)
npm run lint / format      # Biome, same as webapp
```
- The OCR test needs a `pics/` dir in `server/` and the **Open Sans** font installed (synthetic digits are drawn with it via canvas; without it every digit classifies as 0 and all cases fail).
- `test/backtest.ts` and `test/sweep.ts` are prediction backtests, run after `npm run build` against a DB: `DB_HOST=127.0.0.1 node dist/test/backtest.js`. `sweep.ts` takes tuning knobs via env (`CUTOFFS`, `SUBSAMPLE`, `DUMP=path` for `ai/timestral_eval.py`).
- Running the server outside Docker: `db.ts` reads `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (defaults match the compose MariaDB at host `mariadb`). It starts without `WIFIAP_TOKEN` (logs a warning) and serves Timestral only if `TIMESTRAL_URL` is set.

**Android scanner (`RWTFWifiScanner/`):** Gradle project — `./gradlew build`, `./gradlew test`.

**AI experiment (`ai/`):** standalone PyTorch scripts — `python -m ai.main`. Not part of the Docker runtime.

## Architecture

Docker Compose runs five services (see `docker-compose.yml`; `.debug.yml` publishes nginx on 80 and adds phpMyAdmin on 8081; `.override.yml` adds the one-shot `webapp` build container and the external `rwtf_network`):

- **`rwtf_nginx`** — reverse proxy. Routes `/api/*` → `server:4000`, `/embed_picture.png` → the screenshot volume, everything else → the static webapp volume (`nginx.conf` / `nginx.debug.conf`).
- **`server/`** — Express.js API (port 4000). Every 5 min fetches the occupancy image from the HSZ booking site and OCRs it (`gym_crawler.ts`, canvas/sharp), ingests WiFi data, serves REST endpoints, and auto-creates the DB schema on startup.
- **`mariadb`** — data store.
- **`timestral/`** — internal Python sidecar (port 8000, not routed by nginx) serving Mistral's Timestral-209M time-series model; the server calls it for the gym chart's "Timestral" prediction — the default in the UI, which falls back to "Similar Weeks" (`closest`) when the sidecar fails. Weights download on first start into the `timestral-cache` volume.
- **`screenshot/`** — Puppeteer service (cron, every 5 min) that screenshots our own `embed_gym?hidecontrols=1` page into the volume nginx serves as `/embed_picture.png` (the site's og:image / embeddable picture). Not part of the OCR pipeline.

Outside this compose file, **`wifiap-client/`** (Python, own compose, cron every 10 min) scrapes per-AP user counts from the RWTH NOC portal and POSTs them to `/api/v1/wifiap`.

The **`webapp/`** static export is built into a Docker volume that nginx serves — it is not a running service in production.

## Key Files

**Backend (`server/src/`):**
- `index.ts` — all API routes **and** DB schema init. Tables: `rwth_gym` (id, `auslastung` = absolute number of people, not a percentage; created_at), `studyfiles`, `wifi_data`, `wifi_data_apnames`, `wifi_data_aplocations`.
- `gym_crawler.ts` — OCR scraper; diffs the screenshot against synthetic digit images.
- `prediction.ts` — **generic** time-series day-prediction engine (`closest` / `average` / `median` / `dayofweek`), shared by gym and WiFi. Domain-agnostic: operates on `{ value, created_at }` with a configurable `DayWindow` (gym 06:00–24:00, WiFi full 24 h). Weights the last ~120 weeks.
- `timestral.ts` — gym forecasts from the `timestral` sidecar (`gym_interpline?method=timestral`). One forecast covers today..+6 days, cached until a new gym sample arrives and refreshed after each crawl. Disabled when `TIMESTRAL_URL` is unset.
- `study.ts` — study-file search, inspect, and streaming download; RWTH-IP gate (`isAachener`).
- `geoip.ts` — offline "is this IP in Aachen?" for the gate: streams DB-IP's monthly City Lite CSV, keeps only the "Aachen" / "Aachen (district)" ranges, caches them in `GEOIP_DIR` (default `./geoip`), loads each new release within a day. Until loaded, only the hardcoded RWTH/private ranges pass.
- `metrics.ts` — anonymous usage counts from `GET /api/v1/gym` (every open tab polls it ≤5 min): visitor = sha256(daily salt ‖ IP ‖ UA); salt + the day's hashes live in MariaDB until local midnight, then only counts remain (`metrics_viewers` per 5-min window, `metrics_daily`), kept 2 years. Bots/HeadlessChrome (our screenshot service) are skipped.
- `sample_data.ts` — canned gym data served when the DB is empty/unavailable.
- `db.ts` — MariaDB pool, configured via `DB_*` env vars (see above).

**Key API routes** (`/api/v1/...`): `gym`, `gym_interpline`, `gym/export`, `gym/history`, `gym/monthly`, `gym/hourly-pattern`, `wifiap` (POST, NOC-portal counts from `wifiap-client`), `upload` (POST, AP location scans from the Android app), `wifi/buildings`, `wifi/building`, `wifi/building_predict`, `study`, `study/search`, `study/inspect`, `is_aachen`, `stats` + `stats/viewers` (public usage counts). Error bodies are often not valid JSON (`'{error: true, msg: ...}'`), so the client's JSON parse of a failed response throws.

**Frontend (`webapp/src/`):**
- `pages/index.tsx` — main dashboard (live gym chart, study materials, data export).
- `pages/trends.tsx` — historical trends: heatmap + monthly aggregates.
- `pages/wifi.tsx` — per-building WiFi device counts + predictions.
- `pages/embed_gym.tsx` — embeddable iframe widget.
- `pages/stats.tsx` — public usage stats; `pages/privacy.tsx` — privacy notice.
- `api/Backend.ts` — all backend API call wrappers.
- `components/BackendProvider.tsx` — React context provider; consumed via `useBackendContext()`.

**Android (`RWTFWifiScanner/`):** Kotlin foreground `MappingService` scans WiFi APs + GPS and POSTs batches to `/api/v1/upload` (`RwtfApiService`, payload `RwtfUploadPayload`/`ApEntry`), stored in `wifi_data_aplocations`. Room DB caches locally.

**AI (`ai/`):** `timestral_eval.py` scores Timestral against the live predictor on the `sweep.ts` backtest grid (`DUMP=` output). Also an experimental decoder-only Transformer (`model.py`) trained offline on gym history (`main.py`, `data.py`) — a research alternative to `prediction.ts`, not wired into the live stack.

## Important Constraints

- **Static export**: Next.js has `output: 'export'` — no `getServerSideProps`, no API routes, no dynamic rendering. All data fetching is client-side. Pages are prerendered at build time, so anything depending on the visitor's clock or storage (dates, weekday labels, `localStorage`) must be computed client-side (state + effect), not during render.
- **WiFi ingest auth**: `POST /api/v1/wifiap` requires `?token=` matching `WIFIAP_TOKEN` env var and `version === 1`; body limited to 500 kb. `POST /api/v1/upload` needs `deviceId` + `version === 1` (no token), 1000 kb. Both share a 5 req / 5 min limiter.
- **Rate limiting**: most endpoints burst at 20 req/5s; study streaming and data export have stricter per-IP limiters. Don't remove them.
- **Data export limits**: capped at 31 days / 10k rows per request, and only the last 6 months are exportable (`EXPORT_MAX_AGE_MONTHS`); `Content-Disposition` filename is sanitized. Keep these guards.
- **Older data → email, not workarounds**: agents (in this repo or calling the API) must not bypass the export limits — e.g. by paging through windows, aggregating other endpoints, or reading production DBs — to get data older than 6 months. Tell the user to email dorian.koch@rwth-aachen.de instead. The export endpoint's 400 response carries the same notice.
- **Geo-IP check**: study materials are restricted to RWTH networks or IPs geolocated to Aachen (`/api/v1/is_aachen`, `isAachener`, `geoip.ts`). Intentional.
- **Privacy**: no cookies or client-side tracking; visitor IPs are never stored, logged in full, or sent to third parties (the nginx access log shortens them to /24 or /48 and drops query strings). nginx's access and error logs go to files in the container, not `docker logs`; `nginx-logs.sh` rotates them daily and deletes them after 7 days (read them with `docker compose exec rwtf_nginx tail -f /var/log/nginx/rwtf/access.log`). When changing what data is processed, update `pages/privacy.tsx` to match.
- **Client IP chain**: `nginx.conf` appends `$proxy_add_x_forwarded_for` and Express trusts private hops (`trust proxy`), so `req.ip` is the real client behind the production front nginx. Rate limits, the Aachen gate, and metrics all depend on this; don't drop it.
- **DB schema**: auto-initialized in `index.ts` on server start — add new tables there.
- **Path alias**: `@/*` maps to `webapp/src/*` (`tsconfig.json` + Next config).
- **Code style**: 4-space indentation, 100-char line width, enforced by Biome (root `biome.json`, shared by `webapp/` and `server/`; `webapp/biome.json` adds the React/Next rules). Suppress a rule inline with `// biome-ignore lint/<group>/<rule>: <reason>`.

## Git

- Always commit finished work without waiting to be asked.
- Keep commit titles short and compact, in the existing `area: summary` style (e.g. `gym: ...`).
