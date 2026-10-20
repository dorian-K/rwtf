// Gym forecasts from Mistral's Timestral foundation model, served by the `timestral` sidecar
// (timestral/server.py). An alternative to the similar-weeks predictor in prediction.ts.
//
// The model forecasts straight from the raw 5-minute series, so one forecast from the latest sample
// to the end of day +MAX_DAY_OFFSET serves every day tab. It is cached until the crawler stores a
// new sample (refreshTimestral() is called right after each crawl), so requests never wait on the
// model except right after a restart.

import { getConnection } from "./db.js";
import type { DayWindow, PredictedPoint } from "./prediction.js";

const TIMESTRAL_URL = process.env.TIMESTRAL_URL; // unset = feature disabled (e.g. local dev)
const STEP_MS = 5 * 60 * 1000; // crawler cadence, and the grid the model sees
const MAX_GAP_MS = 15 * 60 * 1000; // grid points further than this from a sample are missing
const CONTEXT_STEPS = 16_384; // ~57 days of history (the model accepts up to 32,768)
const MAX_STALENESS_MS = 24 * 60 * 60 * 1000; // refuse to forecast from a dead crawler's data
const FAILURE_BACKOFF_MS = 60 * 1000; // don't hammer a down sidecar on every request
const STALE_FALLBACK_MS = 60 * 60 * 1000; // serve an older forecast this long if the sidecar fails
const REQUEST_TIMEOUT_MS = 120 * 1000;
export const MAX_DAY_OFFSET = 6;
// Median line, inter-quartile inner band, and 5–95% outer band (the chart labels it "~90% range").
const QUANTILES = ["0.05", "0.25", "0.5", "0.75", "0.95"] as const;

interface Forecast {
    latestSample: number; // ms of the newest sample the forecast saw
    horizonEnd: number; // ms of the end of day +MAX_DAY_OFFSET; with latestSample, the cache key
    // quantile -> values at latestSample + (k + 1) * STEP_MS
    q: Record<(typeof QUANTILES)[number], number[]>;
}

let cached: Forecast | undefined;
let inflight: { latestSample: number; horizonEnd: number; promise: Promise<Forecast> } | undefined;
let lastFailure: { at: number; error: Error } | undefined;

export const timestralEnabled = () => TIMESTRAL_URL !== undefined;

// Context on the 5-min grid ending at `end`, linearly interpolated between samples; null where the
// nearest sample is too far away (overnight closure, crawler outages).
function contextGrid(rows: { t: number; v: number }[], end: number): (number | null)[] {
    const out: (number | null)[] = [];
    let j = 0;
    for (let k = CONTEXT_STEPS - 1; k >= 0; k--) {
        const t = end - k * STEP_MS;
        while (j < rows.length && rows[j].t < t) j++;
        const next = rows[j];
        const prev = rows[j - 1];
        if (next && next.t === t) {
            out.push(next.v);
        } else if (prev && next && Math.min(t - prev.t, next.t - t) <= MAX_GAP_MS) {
            out.push(prev.v + ((t - prev.t) / (next.t - prev.t)) * (next.v - prev.v));
        } else {
            out.push(null);
        }
    }
    return out;
}

// End of day +MAX_DAY_OFFSET, in ms: the forecast must reach this far to serve every day tab.
function currentHorizonEnd(): number {
    const end = new Date();
    end.setDate(end.getDate() + MAX_DAY_OFFSET);
    return end.setHours(24, 0, 0, 0);
}

async function computeForecast(latestSample: number, horizonEnd: number): Promise<Forecast> {
    const conn = await getConnection();
    let rows: { t: number; v: number }[];
    try {
        const res = await conn.query(
            "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= ? ORDER BY created_at",
            [new Date(latestSample - CONTEXT_STEPS * STEP_MS - MAX_GAP_MS)],
        );
        rows = res.map((r: any) => ({
            t: new Date(r.created_at).getTime(),
            v: Number(r.auslastung),
        }));
    } finally {
        conn.end();
    }

    const horizon = Math.ceil((horizonEnd - latestSample) / STEP_MS);

    const res = await fetch(`${TIMESTRAL_URL}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            context: contextGrid(rows, latestSample),
            prediction_length: horizon,
            quantiles: QUANTILES.map(Number),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`timestral sidecar: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { quantiles: Record<string, number[]> };
    // The sidecar keys by str(float), e.g. "0.5"; QUANTILES are written to match.
    return { latestSample, horizonEnd, q: body.quantiles as Forecast["q"] };
}

// The forecast for the newest stored sample: cached, deduplicated across concurrent callers. While
// the sidecar is failing (restart, redeploy), a forecast up to STALE_FALLBACK_MS old is served.
export async function getTimestralForecast(): Promise<Forecast> {
    try {
        return await freshForecast();
    } catch (err) {
        if (cached && Date.now() - cached.latestSample < STALE_FALLBACK_MS) return cached;
        throw err;
    }
}

async function freshForecast(): Promise<Forecast> {
    if (!TIMESTRAL_URL) throw new Error("Timestral is not configured");

    const conn = await getConnection();
    let latestSample: number;
    try {
        const res = await conn.query("SELECT MAX(created_at) AS latest FROM rwth_gym");
        latestSample = new Date(res[0]?.latest).getTime();
    } finally {
        conn.end();
    }
    if (!Number.isFinite(latestSample) || Date.now() - latestSample > MAX_STALENESS_MS) {
        throw new Error("no recent gym data to forecast from");
    }

    const horizonEnd = currentHorizonEnd();
    if (cached?.latestSample === latestSample && cached.horizonEnd === horizonEnd) return cached;
    if (inflight) {
        if (inflight.latestSample === latestSample && inflight.horizonEnd === horizonEnd) {
            return inflight.promise;
        }
        // Still computing for an older sample: returning that would give a forecast that starts
        // before the newest sample. Wait for it (the sidecar runs one forecast at a time anyway),
        // then forecast from the newest sample.
        await inflight.promise.catch(() => {});
        return freshForecast();
    }
    if (lastFailure && Date.now() - lastFailure.at < FAILURE_BACKOFF_MS) throw lastFailure.error;

    const started = Date.now();
    const promise = computeForecast(latestSample, horizonEnd)
        .then((f) => {
            cached = f;
            lastFailure = undefined;
            console.log(`timestral forecast refreshed in ${Date.now() - started} ms`);
            return f;
        })
        .catch((error) => {
            lastFailure = { at: Date.now(), error };
            throw error;
        })
        .finally(() => {
            if (inflight?.promise === promise) inflight = undefined;
        });
    inflight = { latestSample, horizonEnd, promise };
    return promise;
}

// Warm the cache after a crawl so page loads don't wait on the model. Errors are only logged.
export function refreshTimestral() {
    if (!TIMESTRAL_URL) return;
    getTimestralForecast().catch((err) => console.error("timestral refresh failed:", err.message));
}

// The forecast for day `dayoffset` (0 = today) within `window`, shaped like predictLine's output:
// timestamps are collapsed onto today's date, as the chart maps every line onto one day. Today's
// line only covers the future; the chart shows the actual series for the past part of the day.
export function timestralLine(f: Forecast, dayoffset: number, window: DayWindow): PredictedPoint[] {
    const day = new Date();
    day.setDate(day.getDate() + dayoffset);
    const from = new Date(day).setHours(window.startHour, 0, 0, 0);
    const to = new Date(day).setHours(window.endHour, 0, 0, 0);
    const today = new Date();

    const line: PredictedPoint[] = [];
    f.q["0.5"].forEach((value, k) => {
        const t = f.latestSample + (k + 1) * STEP_MS;
        if (t < from || t >= to) return;
        const d = new Date(t);
        d.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
        line.push({
            created_at: d.getTime(),
            value,
            lower: f.q["0.25"][k],
            upper: f.q["0.75"][k],
            lowerWide: f.q["0.05"][k],
            upperWide: f.q["0.95"][k],
        });
    });
    return line;
}
