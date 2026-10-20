// Privacy-preserving usage counts, measured from the gym data requests the page already makes
// (every open dashboard/embed tab polls /api/v1/gym at least once per 5 minutes).
//
// A visitor is sha256(daily salt || ip || user agent). The salt and the day's hashes live in the DB
// only for the current day (so restarts don't double-count) and are deleted at local midnight; the
// IP and user agent are never stored. What is kept: viewers per 5-minute window (dashboard vs
// embed) and unique visitors per day, both as plain counts, for RETENTION.

import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getConnection } from "./db.js";

const WINDOW_MS = 5 * 60 * 1000;
const RETENTION = "2 YEAR";
// Crawlers, link previews, scripts, and headless browsers (incl. our own screenshot service).
const BOT_UA = /bot|crawl|spider|slurp|preview|headless|curl|wget|python|node-fetch|axios|go-http/i;

export const METRICS_TABLES = [
    "CREATE TABLE IF NOT EXISTS metrics_salt (day DATE PRIMARY KEY, salt BINARY(32) NOT NULL)",
    `CREATE TABLE IF NOT EXISTS metrics_visitors (
        day DATE NOT NULL,
        hash BINARY(32) NOT NULL,
        PRIMARY KEY (day, hash)
    )`,
    `CREATE TABLE IF NOT EXISTS metrics_viewers (
        window_start DATETIME PRIMARY KEY,
        dashboard INT NOT NULL,
        embed INT NOT NULL
    )`,
    "CREATE TABLE IF NOT EXISTS metrics_daily (day DATE PRIMARY KEY, uniques INT NOT NULL)",
];

// Local calendar day (the container runs in Europe/Berlin), as MariaDB DATE text.
function localDay(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let salt: { day: string; value: Buffer } | undefined;
// Hashes already inserted today by this process, to skip redundant INSERT IGNOREs.
let seenToday = new Set<string>();
let openWindow: { start: number; dashboard: Set<string>; embed: Set<string> } | undefined;

async function saltFor(day: string): Promise<Buffer> {
    if (salt?.day === day) return salt.value;
    const conn = await getConnection();
    try {
        // Racing processes would both insert; IGNORE keeps the first, and everyone reads it back.
        await conn.query("INSERT IGNORE INTO metrics_salt (day, salt) VALUES (?, ?)", [
            day,
            randomBytes(32),
        ]);
        const rows = await conn.query("SELECT salt FROM metrics_salt WHERE day = ?", [day]);
        salt = { day, value: Buffer.from(rows[0].salt) };
        seenToday = new Set();
        return salt.value;
    } finally {
        conn.end();
    }
}

async function record(req: Request) {
    const ua = req.get("user-agent") ?? "";
    if (!ua || BOT_UA.test(ua) || !req.ip) return;

    const now = new Date();
    const day = localDay(now);
    const hash = createHash("sha256")
        .update(await saltFor(day))
        .update(req.ip)
        .update("\0")
        .update(ua)
        .digest();
    const key = hash.toString("hex");

    let surface: "dashboard" | "embed" = "dashboard";
    try {
        if (new URL(req.get("referer") ?? "").pathname.startsWith("/embed_gym")) surface = "embed";
    } catch {
        // no or unparsable Referer: count as dashboard
    }

    const start = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
    if (openWindow && openWindow.start !== start) await flushWindow();
    openWindow ??= { start, dashboard: new Set(), embed: new Set() };
    openWindow[surface].add(key);

    if (!seenToday.has(key)) {
        seenToday.add(key);
        const conn = await getConnection();
        try {
            await conn.query("INSERT IGNORE INTO metrics_visitors (day, hash) VALUES (?, ?)", [
                day,
                hash,
            ]);
        } finally {
            conn.end();
        }
    }
}

// Count a gym data request. Never throws: metrics must not break the endpoint.
export function recordGymView(req: Request) {
    record(req).catch((err) => console.error("metrics:", err.message));
}

// Write the finished 5-minute window and refresh today's unique count.
async function flushWindow() {
    const w = openWindow;
    openWindow = undefined;
    const conn = await getConnection();
    try {
        if (w) {
            // A restart mid-window starts a fresh set; keep the larger of the two counts.
            await conn.query(
                `INSERT INTO metrics_viewers (window_start, dashboard, embed) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE dashboard = GREATEST(dashboard, VALUES(dashboard)),
                                         embed = GREATEST(embed, VALUES(embed))`,
                [new Date(w.start), w.dashboard.size, w.embed.size],
            );
        }
        await updateDaily(conn, localDay());
    } finally {
        conn.end();
    }
}

async function updateDaily(conn: Awaited<ReturnType<typeof getConnection>>, day: string) {
    await conn.query(
        `INSERT INTO metrics_daily (day, uniques)
         SELECT ?, COUNT(*) FROM metrics_visitors WHERE day = ?
         ON DUPLICATE KEY UPDATE uniques = VALUES(uniques)`,
        [day, day],
    );
}

// Past days: finalize their unique counts, then delete their salts and hashes. Also applies the
// retention to the stored counts.
async function rollover() {
    const today = localDay();
    const conn = await getConnection();
    try {
        const past = await conn.query(
            "SELECT DISTINCT DATE_FORMAT(day, '%Y-%m-%d') AS day FROM metrics_visitors WHERE day < ?",
            [today],
        );
        for (const { day } of past) await updateDaily(conn, day);
        await conn.query("DELETE FROM metrics_visitors WHERE day < ?", [today]);
        await conn.query("DELETE FROM metrics_salt WHERE day < ?", [today]);
        await conn.query(
            `DELETE FROM metrics_viewers WHERE window_start < NOW() - INTERVAL ${RETENTION}`,
        );
        await conn.query(`DELETE FROM metrics_daily WHERE day < CURDATE() - INTERVAL ${RETENTION}`);
    } finally {
        conn.end();
    }
}

// Write the window in progress, e.g. before shutting down. The next process starts a fresh window
// set; flushWindow keeps the larger count, so a restart can only undercount that one window.
export async function flushMetrics() {
    if (openWindow) await flushWindow();
}

// Flush windows even when no requests arrive (e.g. the last window before a quiet night), and
// roll over past days. Call after the tables exist.
export function startMetrics() {
    let rolledOver = "";
    const tick = async () => {
        if (openWindow && openWindow.start + WINDOW_MS <= Date.now()) await flushWindow();
        if (rolledOver !== localDay()) {
            await rollover();
            rolledOver = localDay();
        }
    };
    tick().catch((err) => console.error("metrics:", err.message));
    setInterval(() => tick().catch((err) => console.error("metrics:", err.message)), 60 * 1000);
}

// GET /api/v1/stats: unique visitors per day for the last 90 days (from the first recorded day
// on, gaps filled with 0), and the 7-day sum shown on the main page.
export async function getStats(_req: Request, res: Response) {
    const conn = await getConnection();
    try {
        const rows = await conn.query(
            `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, uniques FROM metrics_daily
             WHERE day > CURDATE() - INTERVAL 90 DAY ORDER BY day`,
        );
        const byDay = new Map<string, number>(rows.map((r: any) => [r.day, Number(r.uniques)]));
        const daily: { day: string; uniques: number }[] = [];
        const today = localDay();
        if (rows.length > 0) {
            const d = new Date(`${rows[0].day}T12:00:00`);
            for (let day = localDay(d); day <= today; day = localDay(d)) {
                daily.push({ day, uniques: byDay.get(day) ?? 0 });
                d.setDate(d.getDate() + 1);
            }
        }
        const visits7d = daily.slice(-7).reduce((sum, d) => sum + d.uniques, 0);
        res.json({ visits7d, daily });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true, msg: "Stats unavailable" });
    } finally {
        conn.end();
    }
}

// GET /api/v1/stats/viewers?day=YYYY-MM-DD: people with the site open per 5-minute window. For
// today, the window still in progress is included.
export async function getViewers(req: Request, res: Response) {
    const day = typeof req.query.day === "string" ? req.query.day : localDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        res.status(400).json({ error: true, msg: "Invalid day" });
        return;
    }
    const conn = await getConnection();
    try {
        const rows = await conn.query(
            `SELECT window_start, dashboard, embed FROM metrics_viewers
             WHERE window_start >= ? AND window_start < ? + INTERVAL 1 DAY ORDER BY window_start`,
            [day, day],
        );
        const windows = rows.map((r: any) => ({
            t: new Date(r.window_start).toISOString(),
            dashboard: Number(r.dashboard),
            embed: Number(r.embed),
        }));
        if (openWindow && localDay(new Date(openWindow.start)) === day) {
            windows.push({
                t: new Date(openWindow.start).toISOString(),
                dashboard: openWindow.dashboard.size,
                embed: openWindow.embed.size,
            });
        }
        res.json({ day, windows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true, msg: "Stats unavailable" });
    } finally {
        conn.end();
    }
}
