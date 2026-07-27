import express from "express";
import pool, { getConnection } from "./db.js";
import getAuslastungNumber from "./gym_crawler.js";
import { PoolConnection } from "mariadb";
import { SAMPLE } from "./sample_data.js";
import { downloadStreamFile, isAachener, searchStudyFiles, inspectStudyFile } from "./study.js";
import { rateLimit } from "express-rate-limit";
import {
    buildFullWeek,
    FullWeek,
    predictLine,
    PredictionMethod,
    DayWindow,
    FULL_DAY,
    getCurrentDayData,
} from "./prediction.js";

// The gym is only open ~06:00–24:00, so its predictions cover that window. WiFi uses the full day.
const GYM_WINDOW: DayWindow = { startHour: 6, endHour: 24 };
import "dotenv/config";
import { parse } from "date-fns";
import XXH from "xxhashjs";
import stringify from "json-stable-stringify";

const app = express();
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
app.set("json replacer", (_key: string, value: unknown) => {
    if (typeof value === "bigint") {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
    }
    return value;
});

const limiter_burst = rateLimit({
    windowMs: 5 * 1000, // 20 reqs / 5 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter_burst);

const port = 4000;

async function saveAuslastung(auslastung: number) {
    let conn: PoolConnection;

    getConnection()
        .then((c) => {
            conn = c;
            return conn.query("INSERT INTO rwth_gym (auslastung) VALUES (?)", [auslastung]);
        })
        .then(() => {
            conn.end();
        })
        .catch((err) => {
            console.error(err);
            if (conn) conn.end();
        });
}

async function gymCrawl() {
    getAuslastungNumber()
        .then((num) => {
            return saveAuslastung(num);
        })
        .catch((err) => {
            console.error(err);
        });
}
app.get("/api/v1/gym", async (req, res) => {
    // get offset from query
    let dayoffset = req.query.dayoffset ? parseInt(req.query.dayoffset as string) : 0;

    if (dayoffset < 0 || dayoffset > 6 || isNaN(dayoffset)) {
        res.status(400).send('{error: true, msg: "Invalid dayoffset"}');
        return;
    }

    let conn;
    try {
        conn = await getConnection();
        let startTime = new Date();
        let response: any;
        if (false) {
            response = SAMPLE;
        } else {
            let weeks = [];
            for (let i = 0; i <= 3; i++) {
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - i * 7 + dayoffset);
                startDate.setHours(6, 0, 0, 0);

                const endDate = new Date();
                endDate.setDate(endDate.getDate() - i * 7 + dayoffset);
                endDate.setHours(23, 59, 59, 999);

                const rows = await conn.query(
                    "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= ? AND created_at <= ? LIMIT 500",
                    [startDate, endDate],
                );

                const sanitized = rows.map((row: any) => {
                    return {
                        auslastung: row.auslastung,
                        created_at: row.created_at,
                    };
                });
                weeks.push(sanitized);
            }

            response = {
                data_today: weeks[0],
                data_historic: weeks.slice(1),
                dayoffset: dayoffset,
            };
        }

        let endTime = new Date();
        let queryMs = endTime.getTime() - startTime.getTime();

        // caching
        res.setHeader("Cache-Control", "public, max-age=60"); // 1 minute
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            ...response,
            queryMs: queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("{error: true}");
    } finally {
        if (conn) conn.end();
    }
});
app.get("/api/v1/gym_interpline", async (req, res) => {
    // get offset from query
    let dayoffset = req.query.dayoffset ? parseInt(req.query.dayoffset as string) : 0;

    if (dayoffset < 0 || dayoffset > 6 || isNaN(dayoffset)) {
        res.status(400).send('{error: true, msg: "Invalid dayoffset"}');
        return;
    }

    let conn;
    try {
        conn = await getConnection();
        let startTime = new Date();
        let response: any;

        const NUM_WEEKS = 120; // 2 years and a bit
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + dayoffset);
        const currentDayOfWeek = targetDate.getDay();

        // Calculate prediction line based on selected method
        const methodParam = (req.query.method as string) || "closest";
        const validMethods = ["closest", "average", "median", "dayofweek"];
        const method = (
            validMethods.includes(methodParam) ? methodParam : "closest"
        ) as PredictionMethod;

        let weeks: FullWeek[] = [];
        for (let i = 0; i <= NUM_WEEKS; i++) {
            const weekDate = new Date(targetDate);
            weekDate.setDate(weekDate.getDate() - i * 7);

            const startDate = new Date(weekDate);
            startDate.setDate(startDate.getDate() - currentDayOfWeek);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(weekDate);
            endDate.setDate(endDate.getDate() + (6 - currentDayOfWeek));
            endDate.setHours(23, 59, 59, 999);

            const rows = await conn.query(
                "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= ? AND created_at <= ? LIMIT 3500",
                [startDate, endDate],
            );

            if (i > 60 && rows.length < 20) {
                break; // very little data
            }

            // Adapt the gym's `auslastung` field to the engine's neutral `value` field.
            const sanitized = rows.map((row: any) => {
                return {
                    value: row.auslastung,
                    created_at: row.created_at,
                };
            });
            weeks.push(buildFullWeek(sanitized, i <= 4 ? 3 : 1));
        }

        const predicted = predictLine(method, weeks, currentDayOfWeek, GYM_WINDOW);
        // Map back to the gym's wire format (`auslastung`) so the frontend is unchanged.
        const interpLine = predicted.map((p) => ({
            auslastung: p.value,
            created_at: p.created_at,
        }));

        // calculate all time high
        let allTimeHigh = await conn.query(
            "SELECT MAX(auslastung) as max_auslastung FROM rwth_gym",
        );
        if (allTimeHigh.length > 0) {
            allTimeHigh = allTimeHigh[0].max_auslastung;
        } else {
            allTimeHigh = 0;
        }

        let endTime = new Date();
        let queryMs = endTime.getTime() - startTime.getTime();

        // caching
        res.setHeader("Cache-Control", "public, max-age=" + 60 * 10); // 10 minutes
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            interpLine: interpLine,
            queryMs: queryMs,
            allTimeHigh: allTimeHigh,
            method: method,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("{error: true}");
    } finally {
        if (conn) conn.end();
    }
});
const limiterPost = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 req / 5 minute
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
});
if (!process.env.WIFIAP_TOKEN) {
    console.error("WIFIAP_TOKEN not set!");
}
app.post("/api/v1/wifiap", limiterPost, express.json({ limit: "500kb" }), async (req, res) => {
    const data = req.body;
    if (!data || !data.data || !data.version || !data.header) {
        res.status(400).send('{error: true, msg: "Invalid body"}');
        return;
    }
    if (data.version !== 1) {
        res.status(400).send('{error: true, msg: "Invalid version"}');
        return;
    }

    // maybe our wifiap token is not set correctly
    if (!process.env.WIFIAP_TOKEN) {
        res.status(500).send('{error: true, msg: "Server not correctly configured"}');
        return;
    }
    // get token from url
    const token = req.query.token;
    if (token !== process.env.WIFIAP_TOKEN) {
        res.status(403).send('{error: true, msg: "Invalid token"}');
        return;
    }

    let conn;
    try {
        let keys = data.header;
        conn = await getConnection();
        await conn.beginTransaction();
        let numAdded = 0;
        try {
            for (const rowWithoutKeys of data.data) {
                let row: any = {};
                for (let i = 0; i < keys.length; i++) {
                    row[keys[i]] = rowWithoutKeys[i];
                }
                // insert into wifi_data_apnames
                await conn.query(
                    `INSERT INTO wifi_data_apnames (apname, location, building, organisation) VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE apname=apname`,
                    [row["Name"], row["Cover / Ort"], row["Gebäude"], row["Organisation"]],
                );

                // check if the numbers are parseable ints
                if (
                    isNaN(parseInt(row["Nutzer 2.4 GHz"])) ||
                    isNaN(parseInt(row["Nutzer 5 GHz"]))
                ) {
                    console.error("Invalid data for wifiap", row);
                } else {
                    await conn.query(
                        `INSERT INTO wifi_data (apname, users_2_4_ghz, users_5_ghz, online, last_online) VALUES (?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE apname=apname`,
                        [
                            row["Name"],
                            row["Nutzer 2.4 GHz"],
                            row["Nutzer 5 GHz"],
                            row["Online"] ? 1 : 0,
                            parse(
                                row["Zuletzt als online geprüft"],
                                "dd.MM.yyyy HH:mm",
                                new Date(),
                            ),
                        ],
                    );
                    numAdded++;
                }
                // insert into wifi_data
            }
            await conn.commit();
            console.log(`Added ${numAdded} wifi AP entries from uploader ${req.ip}`);
        } catch (err) {
            await conn.rollback();
            console.error(err);
            throw err;
        }
        res.json({ status: "ok" });
    } catch (err) {
        console.error(err);
        res.status(500).send("{error: true}");
    } finally {
        if (conn) conn.end();
    }
});

function hashObj(obj: any): string {
    const canonical = stringify(obj)!;
    return XXH.h64(canonical, 0xcafebabe).toString(16); // seed is arbitrary
}

app.post("/api/v1/upload", limiterPost, express.json({ limit: "1000kb" }), async (req, res) => {
    const data = req.body;

    if (!data || !data.deviceId || !data.version || data.version !== 1 || !data.data) {
        res.status(400).send('{"ok": false, "msg": "Invalid body"}');
        return;
    }

    const deviceId = data.deviceId;
    const rawData = data.data;
    // check datatypes
    if (!Array.isArray(rawData) || rawData.length === 0) {
        res.status(400).send('{"ok": false, "msg":  "Invalid data"}');
        return;
    }
    if (deviceId.length > 254 || deviceId.length < 1) {
        res.status(400).send('{"ok": false, "msg":  "Device ID too long"}');
        return;
    }

    let conn;
    try {
        conn = await getConnection();
        await conn.beginTransaction();
        try {
            for (const row of rawData) {
                if (!row.name || !row.latitude || !row.longitude) {
                    res.status(400).send('{"ok": false, "msg": "Invalid data"}');
                    return;
                }
                // hash the row
                const hash = hashObj(row);
                // insert into wifi_data_aplocations
                await conn.query(
                    `INSERT INTO wifi_data_aplocations (uploader_id, apname, latitude, longitude, raw, hash) VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE hash=hash`,
                    [deviceId, row.name, row.latitude, row.longitude, JSON.stringify(row), hash],
                );
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).send('{"ok": false}');
    } finally {
        if (conn) conn.end();
    }
});

const limiterdoc1 = rateLimit({
    windowMs: 1 * 60 * 1000, // 20 reqs / 1 minute
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
const limiterdoc2 = rateLimit({
    windowMs: 6 * 60 * 60 * 1000, // 72 docs / 6 hours = doc every 5 minutes
    limit: 72,
    standardHeaders: true,
    legacyHeaders: false,
});
app.get("/api/v1/study", limiterdoc1, limiterdoc2, downloadStreamFile);

// Read-only search/inspect over already-downloaded study files. Lighter limit than the doc
// download endpoints since these only hit the local DB (no StudyDrive fetch).
const limiterStudyRead = rateLimit({
    windowMs: 60_000, // 60 reads / minute
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});
app.get("/api/v1/study/search", limiterStudyRead, searchStudyFiles);
app.get("/api/v1/study/inspect", limiterStudyRead, inspectStudyFile);

app.get("/api/v1/is_aachen", async (req, res) => {
    if (await isAachener(req, res)) {
        res.json({ status: true, ip: req.ip });
    } else {
        res.json({ status: false, ip: req.ip });
    }
});

// Rate limiter for export endpoint: 5 requests per hour per IP
const limiterExport = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
});

// GET /api/v1/gym/export - Export gym data as CSV or JSON
// Query params: start_date, end_date, format (csv/json)
app.get("/api/v1/gym/export", limiterExport, async (req, res) => {
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const formatParam = (req.query.format as string) || "csv";
    const format = formatParam === "json" || formatParam === "csv" ? formatParam : "csv";

    if (!startDateStr || !endDateStr) {
        res.status(400).json({ error: true, msg: "start_date and end_date are required" });
        return;
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
        res.status(400).json({ error: true, msg: "Invalid date format. Use YYYY-MM-DD." });
        return;
    }

    // Parse as local midnight (avoid UTC interpretation of YYYY-MM-DD)
    const parseLocalDate = (str: string): Date => {
        const [year, month, day] = str.split("-").map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    };

    const startDate = parseLocalDate(startDateStr);
    const endDate = parseLocalDate(endDateStr);
    // End of end date in local time (23:59:59.999)
    const endOfEndDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ error: true, msg: "Invalid date format" });
        return;
    }

    // Limit to 31 days max (per PR specification)
    const maxRangeMs = 31 * 24 * 60 * 60 * 1000;
    const rangeMs = endDate.getTime() - startDate.getTime();
    if (rangeMs > maxRangeMs || rangeMs < 0) {
        res.status(400).json({ error: true, msg: "Date range cannot exceed 31 days" });
        return;
    }

    // Safety limit: 10,000 data points per request (per PR specification)
    const MAX_ROWS = 10000;
    let conn;
    try {
        conn = await getConnection();

        // Query with LIMIT MAX_ROWS + 1 to detect overflow without extra COUNT query
        const rows = await conn.query(
            `SELECT auslastung, created_at
            FROM rwth_gym
            WHERE created_at >= ? AND created_at <= ?
            ORDER BY created_at
            LIMIT ?`,
            [startDate, endOfEndDate, MAX_ROWS + 1],
        );

        const hasMore = rows.length > MAX_ROWS;
        const exportRows = hasMore ? rows.slice(0, MAX_ROWS) : rows;

        if (hasMore) {
            res.status(400).json({
                error: true,
                msg: `Export limit exceeded. Maximum 10,000 data points per request. Please narrow your date range.`,
            });
            conn.end();
            return;
        }

        // Helper to format timestamps as ISO strings regardless of input type
        const formatTimestamp = (value: any): string => {
            if (value instanceof Date) return value.toISOString();
            const d = new Date(value);
            return isNaN(d.getTime()) ? String(value) : d.toISOString();
        };

        // Build Content-Disposition: sanitize all values for header safety
        const safeStr = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="gym_data_${safeStr(startDateStr)}_${safeStr(endDateStr)}.${safeStr(format)}"`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");

        if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.json({
                data: exportRows.map((r: any) => ({
                    timestamp: formatTimestamp(r.created_at),
                    utilization: r.auslastung,
                })),
                metadata: {
                    start_date: startDateStr,
                    end_date: endDateStr,
                    total_samples: exportRows.length,
                },
            });
        } else {
            // CSV format — strictly two-column, no injected comment lines
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("X-Data-Truncated", "false");

            // Build CSV using array join to avoid repeated string concatenation
            const lines: string[] = ["timestamp,utilization"];
            for (const row of exportRows) {
                lines.push(`${formatTimestamp(row.created_at)},${row.auslastung}`);
            }

            res.send(lines.join("\n") + "\n");
        }

        console.log(
            `Export: ${req.ip} downloaded ${exportRows.length} rows (format=${format}, range=${startDateStr} to ${endDateStr})`,
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// Historical trends endpoints

// GET /api/v1/gym/history - aggregated historical data
// Query params: start_date, end_date, aggregation (hour/day/week/month)
app.get("/api/v1/gym/history", async (req, res) => {
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const aggregation = (req.query.aggregation as string) || "day";

    if (!startDateStr || !endDateStr) {
        res.status(400).json({ error: true, msg: "start_date and end_date are required" });
        return;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ error: true, msg: "Invalid date format" });
        return;
    }

    // No artificial range limit — the GROUP BY aggregation keeps the result set small.

    // Determine date truncation based on aggregation
    let dateFormat: string;
    switch (aggregation) {
        case "hour":
            dateFormat = "%Y-%m-%d %H:00";
            break;
        case "week":
            dateFormat = "%Y-%u"; // ISO week
            break;
        case "month":
            dateFormat = "%Y-%m";
            break;
        case "day":
        default:
            dateFormat = "%Y-%m-%d";
    }

    let conn;
    try {
        conn = await getConnection();
        const startTime = new Date();

        // Using DATE_FORMAT for grouping - works with both MySQL and MariaDB
        const rows = await conn.query(
            `SELECT 
                DATE_FORMAT(created_at, ?) as time_bucket,
                AVG(auslastung) as avg_utilization,
                MAX(auslastung) as max_utilization,
                MIN(auslastung) as min_utilization,
                COUNT(*) as sample_count
            FROM rwth_gym 
            WHERE created_at >= ? AND created_at <= ?
            GROUP BY time_bucket
            ORDER BY time_bucket`,
            [dateFormat, startDate, endDate],
        );

        let queryMs = new Date().getTime() - startTime.getTime();

        res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour cache
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            data: rows,
            aggregation: aggregation,
            startDate: startDateStr,
            endDate: endDateStr,
            queryMs: queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// GET /api/v1/gym/monthly - monthly aggregates
app.get("/api/v1/gym/monthly", async (req, res) => {
    let conn;
    try {
        conn = await getConnection();
        const startTime = new Date();

        // Get monthly aggregates for the last 24 months
        const rows = await conn.query(
            `SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                AVG(auslastung) as avg_utilization,
                MAX(auslastung) as max_utilization,
                MIN(auslastung) as min_utilization,
                COUNT(*) as sample_count
            FROM rwth_gym 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 MONTH)
            GROUP BY month
            ORDER BY month`,
        );

        // Also get peak hour for each month
        const peakHours = await conn.query(
            `SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                HOUR(created_at) as hour,
                AVG(auslastung) as avg_utilization
            FROM rwth_gym 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 MONTH)
            GROUP BY month, hour
            ORDER BY month, avg_utilization DESC`,
        );

        // For each month, find the hour with highest average utilization
        const peakHoursMap: Record<string, number> = {};
        for (const row of peakHours) {
            const month = row.month;
            if (!(month in peakHoursMap)) {
                peakHoursMap[month] = row.hour;
            }
        }

        // Combine data
        const result = rows.map((row: any) => ({
            month: row.month,
            avg_utilization: Math.round(row.avg_utilization * 100) / 100,
            max_utilization: row.max_utilization,
            min_utilization: row.min_utilization,
            total_samples: row.sample_count,
            peak_hour: peakHoursMap[row.month] !== undefined ? peakHoursMap[row.month] : null,
        }));

        let queryMs = new Date().getTime() - startTime.getTime();

        res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hour cache
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            data: result,
            queryMs: queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// GET /api/v1/gym/hourly-pattern - typical patterns by hour
app.get("/api/v1/gym/hourly-pattern", async (req, res) => {
    let conn;
    try {
        conn = await getConnection();
        const startTime = new Date();

        // Get average utilization by hour of day (aggregated across all days)
        const rows = await conn.query(
            `SELECT 
                HOUR(created_at) as hour,
                AVG(auslastung) as avg_utilization,
                MAX(auslastung) as max_utilization,
                MIN(auslastung) as min_utilization,
                COUNT(*) as sample_count
            FROM rwth_gym 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY hour
            ORDER BY hour`,
        );

        // Also get day-of-week patterns
        const dayOfWeekRows = await conn.query(
            `SELECT 
                DAYOFWEEK(created_at) as day_of_week,
                AVG(auslastung) as avg_utilization,
                COUNT(*) as sample_count
            FROM rwth_gym 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY day_of_week
            ORDER BY day_of_week`,
        );

        // And hour x day-of-week heatmap data
        const heatmapRows = await conn.query(
            `SELECT 
                DAYOFWEEK(created_at) as day_of_week,
                HOUR(created_at) as hour,
                AVG(auslastung) as avg_utilization,
                COUNT(*) as sample_count
            FROM rwth_gym 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour`,
        );

        let queryMs = new Date().getTime() - startTime.getTime();

        res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hour cache
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            hourly: rows,
            dayOfWeek: dayOfWeekRows,
            heatmap: heatmapRows,
            queryMs: queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// Resolve which APs currently belong to a building, using each AP's latest metadata row (highest
// id) so APs whose building label changed over time are attributed to their current building.
async function resolveBuildingApnames(conn: PoolConnection, building: string): Promise<string[]> {
    const apRows = await conn.query(
        `SELECT wan.apname
         FROM wifi_data_apnames wan
         INNER JOIN (SELECT apname, MAX(id) AS max_id FROM wifi_data_apnames GROUP BY apname) latest
             ON wan.apname = latest.apname AND wan.id = latest.max_id
         WHERE wan.building = ?`,
        [building],
    );
    return apRows.map((r: any) => r.apname);
}

// Aggregate a building into a single device-count time series over [startDate, endDate]: average
// each AP within 10-minute buckets (smooths multiple uploads), then sum across online APs so each
// bucket is "total connected devices in the building". Absent APs contribute nothing (correct for
// gaps); offline rows are excluded. Returns points shaped for the prediction engine.
async function fetchBuildingSeries(
    conn: PoolConnection,
    apnames: string[],
    startDate: Date,
    endDate: Date,
): Promise<{ value: number; created_at: Date }[]> {
    if (apnames.length === 0) return [];
    const inPlaceholders = apnames.map(() => "?").join(",");
    // Group on an integer bucket key rather than a formatted datetime string —
    // integer GROUP BY is far cheaper over hundreds of thousands of rows.
    // Bucket width is 10 min (600 s) to match the real ~10-min sample cadence:
    // a finer bucket would split each AP's single reading across windows, so a
    // given bucket would sum over only the subset of APs that reported in it,
    // producing a steppy aggregate. 10 min lands every AP in the same bucket.
    // Reconstruct the timestamp from the epoch-second key (bucket10 * 600 s).
    const rows = await conn.query(
        `SELECT per_ap.bucket10 * 600000 AS created_at, SUM(ap_avg) AS value
         FROM (
            SELECT
                FLOOR(UNIX_TIMESTAMP(insert_time) / 600) AS bucket10,
                apname,
                AVG(users_2_4_ghz + users_5_ghz) AS ap_avg
            FROM wifi_data
            WHERE apname IN (${inPlaceholders})
              AND online = 1
              AND insert_time >= ? AND insert_time <= ?
            GROUP BY bucket10, apname
         ) per_ap
         GROUP BY per_ap.bucket10
         ORDER BY per_ap.bucket10`,
        [...apnames, startDate, endDate],
    );
    // DECIMAL aggregates can arrive as strings — coerce to Number for the math
    // engine. created_at comes back as epoch-ms; the engine treats it as a Date-ish.
    return rows.map((r: any) => ({
        value: Number(r.value),
        created_at: new Date(Number(r.created_at)),
    }));
}

// GET /api/v1/wifi/buildings — list all distinct buildings that have AP metadata
app.get("/api/v1/wifi/buildings", async (req, res) => {
    if (!(await isAachener(req, res))) {
        res.status(403).json({ error: true, msg: "Access restricted to Aachen network" });
        return;
    }
    let conn;
    try {
        conn = await getConnection();
        const rows = await conn.query(
            `SELECT DISTINCT building FROM wifi_data_apnames
             WHERE building IS NOT NULL AND building != ''
             ORDER BY building`,
        );
        res.setHeader("Cache-Control", "public, max-age=300");
        res.json({ buildings: rows.map((r: any) => r.building) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// GET /api/v1/wifi/building?building=X&hours=24
// Returns current aggregate + 10-minute history for a building.
// Handles new/disabled APs: absent APs produce no rows (not counted); offline APs filtered by online=1.
// Multiple uploads per 10-minute window are averaged per AP before summing, so the total is stable.
// Performance: resolves the building's AP set from the small metadata table first, then filters
// wifi_data by that concrete apname list (idx_apname) + a time bound — never scans full history.
app.get("/api/v1/wifi/building", async (req, res) => {
    if (!(await isAachener(req, res))) {
        res.status(403).json({ error: true, msg: "Access restricted to Aachen network" });
        return;
    }
    const building = req.query.building as string;
    if (!building) {
        res.status(400).json({ error: true, msg: "building is required" });
        return;
    }
    let hours = parseInt((req.query.hours as string) || "24");
    if (isNaN(hours) || hours < 1 || hours > 168) hours = 24;

    // "Current" snapshot window: an AP that hasn't reported within this many hours is treated as
    // gone (handles disabled routers — they simply drop out of the current totals).
    const CURRENT_WINDOW_HOURS = 3;

    let conn;
    try {
        conn = await getConnection();
        const t0 = new Date();

        // Step 1: resolve which APs currently belong to this building (cheap — metadata table is
        // small). See resolveBuildingApnames for how renamed/moved APs are handled.
        const apnames = await resolveBuildingApnames(conn, building);

        // No APs map to this building → nothing to aggregate. Return an empty-but-valid payload
        // instead of running heavy queries with an empty IN () list.
        if (apnames.length === 0) {
            res.setHeader("Cache-Control", "public, max-age=60");
            res.json({
                building,
                current: { total_users: 0, active_aps: 0, total_aps: 0, last_updated: null },
                history: [],
                queryMs: new Date().getTime() - t0.getTime(),
            });
            return;
        }

        // Build a parameterized IN (?, ?, …) list. Filtering wifi_data by this concrete AP set lets
        // MariaDB use idx_apname instead of scanning the whole history table.
        const inPlaceholders = apnames.map(() => "?").join(",");

        // Step 2 — 10-minute history: average per AP per bucket first (handles multiple uploads
        // within the same 10-minute window), then sum across APs. Absent APs contribute no rows,
        // which is correct for gaps; offline rows are filtered out by online = 1.
        const historyRows = await conn.query(
            `SELECT
                time_bucket,
                ROUND(SUM(ap_avg_users)) AS total_users,
                COUNT(*) AS active_aps
            FROM (
                SELECT
                    FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(insert_time) / 600) * 600) AS time_bucket,
                    apname,
                    AVG(users_2_4_ghz + users_5_ghz) AS ap_avg_users
                FROM wifi_data
                WHERE apname IN (${inPlaceholders})
                  AND online = 1
                  AND insert_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
                GROUP BY time_bucket, apname
            ) AS per_ap
            GROUP BY time_bucket
            ORDER BY time_bucket`,
            [...apnames, hours],
        );

        // Step 3 — current state: take each AP's most recent row within the snapshot window, then
        // aggregate. APs that haven't reported within CURRENT_WINDOW_HOURS are excluded entirely, so
        // disabled routers naturally drop out; an AP whose latest row is offline counts toward
        // total_aps but not active_aps / total_users.
        const currentRows = await conn.query(
            `SELECT
                SUM(CASE WHEN wd.online = 1 THEN wd.users_2_4_ghz + wd.users_5_ghz ELSE 0 END) AS total_users,
                SUM(CASE WHEN wd.online = 1 THEN 1 ELSE 0 END) AS active_aps,
                COUNT(*) AS total_aps,
                MAX(wd.insert_time) AS last_updated
            FROM wifi_data wd
            INNER JOIN (
                SELECT apname, MAX(insert_time) AS max_insert
                FROM wifi_data
                WHERE apname IN (${inPlaceholders})
                  AND insert_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
                GROUP BY apname
            ) latest ON wd.apname = latest.apname AND wd.insert_time = latest.max_insert`,
            [...apnames, CURRENT_WINDOW_HOURS],
        );

        const cur = currentRows[0] ?? {};
        const queryMs = new Date().getTime() - t0.getTime();

        res.setHeader("Cache-Control", "public, max-age=60");
        res.json({
            building,
            current: {
                total_users: Number(cur.total_users) || 0,
                active_aps: Number(cur.active_aps) || 0,
                total_aps: Number(cur.total_aps) || 0,
                last_updated: cur.last_updated ?? null,
            },
            history: historyRows.map((r: any) => ({
                time: r.time_bucket,
                total_users: Number(r.total_users),
                active_aps: Number(r.active_aps),
            })),
            queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

// GET /api/v1/wifi/building_predict?building=X&method=closest&dayoffset=0
// Predicts the device-count curve for a building's current day, mirroring the gym predictor.
// Returns the actual series so far today plus the predicted line for the full day.
app.get("/api/v1/wifi/building_predict", async (req, res) => {
    if (!(await isAachener(req, res))) {
        res.status(403).json({ error: true, msg: "Access restricted to Aachen network" });
        return;
    }
    const building = req.query.building as string;
    if (!building) {
        res.status(400).json({ error: true, msg: "building is required" });
        return;
    }

    let dayoffset = req.query.dayoffset ? parseInt(req.query.dayoffset as string) : 0;
    if (isNaN(dayoffset) || dayoffset < 0 || dayoffset > 6) dayoffset = 0;

    const methodParam = (req.query.method as string) || "closest";
    const validMethods = ["closest", "average", "median", "dayofweek"];
    const method = (
        validMethods.includes(methodParam) ? methodParam : "closest"
    ) as PredictionMethod;

    // WiFi history is shallow compared to the gym (only a few months). Cap the lookback window; weeks
    // with no data simply produce no rows in the single range query below, so empties are free.
    const NUM_WEEKS = 26;

    let conn;
    try {
        conn = await getConnection();
        const t0 = new Date();

        const apnames = await resolveBuildingApnames(conn, building);
        if (apnames.length === 0) {
            res.setHeader("Cache-Control", "public, max-age=300");
            res.json({ building, dataToday: [], interpLine: [], method, dayoffset });
            return;
        }

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + dayoffset);
        const currentDayOfWeek = targetDate.getDay();

        // Start of the target's (Sunday-aligned) week.
        const currentWeekStart = new Date(targetDate);
        currentWeekStart.setDate(currentWeekStart.getDate() - currentDayOfWeek);
        currentWeekStart.setHours(0, 0, 0, 0);

        // Fetch the whole lookback window in ONE query, then split into weeks in JS. This replaces
        // ~10 sequential per-week queries (each its own index seek + GROUP BY round-trip) with a
        // single index range scan — empty trailing weeks cost nothing since the range simply has no
        // rows there.
        const rangeStart = new Date(currentWeekStart);
        rangeStart.setDate(rangeStart.getDate() - NUM_WEEKS * 7);
        const rangeEnd = new Date(currentWeekStart);
        rangeEnd.setDate(rangeEnd.getDate() + 7);
        rangeEnd.setMilliseconds(rangeEnd.getMilliseconds() - 1);

        const series = await fetchBuildingSeries(conn, apnames, rangeStart, rangeEnd);

        // Bucket points into Sunday-aligned weeks, indexed by how many weeks back from the target
        // week they fall (0 = current week). Mirrors the old per-week weighting exactly.
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        const byWeek = new Map<number, { value: number; created_at: any }[]>();
        let maxIdx = 0;
        for (const p of series) {
            const pd = new Date(p.created_at);
            const pWeekStart = new Date(pd);
            pWeekStart.setDate(pWeekStart.getDate() - pd.getDay());
            pWeekStart.setHours(0, 0, 0, 0);
            const idx = Math.round((currentWeekStart.getTime() - pWeekStart.getTime()) / WEEK_MS);
            if (idx < 0) continue; // defensive: ignore anything past the target week
            const bucket = byWeek.get(idx);
            if (bucket) bucket.push(p);
            else byWeek.set(idx, [p]);
            if (idx > maxIdx) maxIdx = idx;
        }

        const weeks: FullWeek[] = [];
        for (let i = 0; i <= maxIdx; i++) {
            // Recent weeks weighted 3x, like the gym predictor.
            weeks.push(buildFullWeek(byWeek.get(i) ?? [], i <= 4 ? 3 : 1));
        }
        if (weeks.length === 0) weeks.push(buildFullWeek([], 3)); // ensure weeks[0] exists

        const predicted = predictLine(method, weeks, currentDayOfWeek, FULL_DAY);
        // The in-progress day lives in week[0]; extract it as the "actual so far" series.
        const dataToday = getCurrentDayData(weeks[0], currentDayOfWeek);

        const queryMs = new Date().getTime() - t0.getTime();
        res.setHeader("Cache-Control", "public, max-age=" + 60 * 10); // 10 minutes
        res.setHeader("Server-Timing", `db;dur=${queryMs}`);
        res.json({
            building,
            dataToday,
            interpLine: predicted,
            method,
            dayoffset,
            queryMs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: true });
    } finally {
        if (conn) conn.end();
    }
});

app.get("/api", (req, res) => {
    res.send("Hello World!");
});

const database_init = async () => {
    let conn;
    try {
        conn = await getConnection();

        await conn.query(
            `CREATE TABLE IF NOT EXISTS wifi_data (
                id SERIAL PRIMARY KEY,
                insert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                apname VARCHAR(100) NOT NULL,
                users_2_4_ghz SMALLINT NOT NULL,
                users_5_ghz SMALLINT NOT NULL,
                online SMALLINT NOT NULL,
                last_online TIMESTAMP NOT NULL,

                UNIQUE KEY unique_apname_last_online (apname, last_online)
            )`,
        );
        await conn.query("CREATE INDEX IF NOT EXISTS idx_insert_time ON wifi_data (last_online)");
        await conn.query("CREATE INDEX IF NOT EXISTS idx_apname ON wifi_data (apname)");
        await conn.query(
            "CREATE INDEX IF NOT EXISTS idx_wifi_insert_time ON wifi_data (insert_time)",
        );
        // Composite index for the per-building queries: filters by a set of apnames AND a recent
        // insert_time range. Lets MariaDB seek straight to each AP's recent rows instead of scanning
        // that AP's entire history (the table has ~18M rows). Used by the "current" snapshot query.
        await conn.query(
            "CREATE INDEX IF NOT EXISTS idx_wifi_apname_insert ON wifi_data (apname, insert_time)",
        );
        // Covering index for the history & prediction aggregations, which filter by (apname, online,
        // insert_time) and then read the user-count columns. Including those columns makes the scan
        // index-only — no per-row lookups into the 18M-row table, which is the dominant cost for the
        // prediction's multi-week range scan.
        await conn.query(
            `CREATE INDEX IF NOT EXISTS idx_wifi_cover
             ON wifi_data (apname, online, insert_time, users_2_4_ghz, users_5_ghz)`,
        );

        await conn.query(
            `CREATE TABLE IF NOT EXISTS wifi_data_apnames (
                id INT AUTO_INCREMENT PRIMARY KEY,
                insert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                apname VARCHAR(255) NOT NULL,
                location VARCHAR(255) NOT NULL,
                building VARCHAR(255) NOT NULL,
                organisation VARCHAR(255) NOT NULL,

                UNIQUE KEY unique_apname_combo (apname, location, building, organisation)
            )`,
        );
        await conn.query("CREATE INDEX IF NOT EXISTS idx_apname ON wifi_data_apnames (apname)");

        await conn.query(
            `CREATE TABLE IF NOT EXISTS wifi_data_aplocations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uploader_id VARCHAR(255) NOT NULL,
                apname VARCHAR(255) NOT NULL,
                latitude DECIMAL(10, 7) NOT NULL,
                longitude DECIMAL(10, 7) NOT NULL,
                hash VARCHAR(64) NOT NULL UNIQUE,
                raw JSON NOT NULL
            )`,
        );
        await conn.query(
            "CREATE INDEX IF NOT EXISTS idx_loc_apname ON wifi_data_aplocations (apname)",
        );

        await conn.query(
            "CREATE TABLE IF NOT EXISTS rwth_gym (id INT AUTO_INCREMENT PRIMARY KEY, auslastung INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        );
        // index for created_at
        await conn.query("CREATE INDEX IF NOT EXISTS idx_created_at ON rwth_gym (created_at)");
        // other optimizations
        await conn.query("OPTIMIZE TABLE rwth_gym");
        await conn.query("ANALYZE TABLE rwth_gym");

        await conn.query(
            `CREATE TABLE IF NOT EXISTS studyfiles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                study_id VARCHAR(255) NOT NULL UNIQUE,
                path VARCHAR(511) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                filename VARCHAR(511) NOT NULL,
                course_name VARCHAR(511) NOT NULL,
                file_type INT NOT NULL,
                university_name VARCHAR(255) NOT NULL,
                professor_name VARCHAR(255) NOT NULL,
                semester_label VARCHAR(255) NOT NULL,
                json_data TEXT NOT NULL
            )`,
        );
        // Keeps the default "newest" sort of the study search cheap. The free-text LIKE '%q%'
        // scan can't use a B-tree index (leading wildcard), but the table is small.
        await conn.query(
            "CREATE INDEX IF NOT EXISTS idx_studyfiles_created ON studyfiles (created_at)",
        );
        console.log("Database initialized");

        if (conn) conn.end();
    } catch (err) {
        console.error(err);
        if (conn) conn.end();
        throw err;
    }
};

// init database
database_init()
    //.then(database_init)
    .then(() => {
        setInterval(gymCrawl, 1000 * 60 * 5); // 5 minutes
        gymCrawl();

        let server = app.listen(port, () => {
            console.log(`Example app listening on port ${port}`);
        });

        process.on("SIGTERM", async () => {
            console.log("SIGTERM signal");
            await pool.end();
            server.close();
            process.exit(0);
        });
    });
