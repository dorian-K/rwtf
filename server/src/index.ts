import express from "express";
import pool, { getConnection } from "./db.js";
import getAuslastungNumber from "./gym_crawler.js";
import { PoolConnection } from "mariadb";
import { SAMPLE } from "./sample_data.js";
import { downloadStreamFile, isAachener } from "./study.js";
import { rateLimit } from "express-rate-limit";
import { GymDataWeek, makeAverageLine, makeClosestLine, makeDayOfWeekLine } from "./gym_math.js";
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
                    [startDate, endDate]
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

        let weeks: GymDataWeek[] = [];

        // old `makeAverageLine` used 12 weeks of data and did not include current week
        const NUM_WEEKS = 60; // 1 year and a bit
        for (let i = 0; i <= NUM_WEEKS; i++) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - i * 7 + dayoffset);
            startDate.setHours(6, 0, 0, 0);

            const endDate = new Date();
            endDate.setDate(endDate.getDate() - i * 7 + dayoffset);
            endDate.setHours(23, 59, 59, 999);

            const rows = await conn.query(
                "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= ? AND created_at <= ? LIMIT 500",
                [startDate, endDate]
            );

            const sanitized = rows.map((row: any) => {
                return {
                    auslastung: row.auslastung,
                    created_at: row.created_at,
                };
            });
            weeks.push({
                data: sanitized,
                weight: i <= 4 ? 3 : 1, // prefer recent weeks more heavily
            });
        }
        // Calculate prediction line based on selected method
        const methodParam = (req.query.method as string) || "closest";
        const validMethods = ["closest", "average", "median", "dayofweek"];
        const method = validMethods.includes(methodParam) ? methodParam : "closest";
        let interpLine;
        const targetDate = new Date(Date.now() + dayoffset * 24 * 3600000);
        const currentDayOfWeek = targetDate.getDay();
        
        switch (method) {
            case "average":
                // Simple weighted average of all historical weeks
                interpLine = makeAverageLine(weeks);
                break;
            case "median":
                // Weighted average using median (more robust to outliers)
                interpLine = makeAverageLine(weeks, true);
                break;
            case "dayofweek":
                // Average only data from the same day of week
                interpLine = makeDayOfWeekLine(weeks, currentDayOfWeek);
                break;
            case "closest":
            default:
                // Find most similar weeks to current week (excluding current week itself) and average them
                interpLine = makeClosestLine(weeks.slice(1), weeks[0].data);
        }

        // calculate all time high
        let allTimeHigh = await conn.query(
            "SELECT MAX(auslastung) as max_auslastung FROM rwth_gym"
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
                    [row["Name"], row["Cover / Ort"], row["Gebäude"], row["Organisation"]]
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
                                new Date()
                            ),
                        ]
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
                    [deviceId, row.name, row.latitude, row.longitude, JSON.stringify(row), hash]
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
app.get("/api/v1/is_aachen", async (req, res) => {
    if (await isAachener(req, res)) {
        res.json({ status: true, ip: req.ip });
    } else {
        res.json({ status: false, ip: req.ip });
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

    // Limit to 2 years max to protect database
    const maxRangeMs = 730 * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
        res.status(400).json({ error: true, msg: "Date range cannot exceed 1 year" });
        return;
    }

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
            [dateFormat, startDate, endDate]
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
            ORDER BY month`
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
            ORDER BY month, avg_utilization DESC`
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
            ORDER BY hour`
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
            ORDER BY day_of_week`
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
            ORDER BY day_of_week, hour`
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
            )`
        );
        await conn.query("CREATE INDEX IF NOT EXISTS idx_insert_time ON wifi_data (last_online)");
        await conn.query("CREATE INDEX IF NOT EXISTS idx_apname ON wifi_data (apname)");

        await conn.query(
            `CREATE TABLE IF NOT EXISTS wifi_data_apnames (
                id INT AUTO_INCREMENT PRIMARY KEY,
                insert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                apname VARCHAR(255) NOT NULL,
                location VARCHAR(255) NOT NULL,
                building VARCHAR(255) NOT NULL,
                organisation VARCHAR(255) NOT NULL,

                UNIQUE KEY unique_apname_combo (apname, location, building, organisation)
            )`
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
            )`
        );
        await conn.query(
            "CREATE INDEX IF NOT EXISTS idx_loc_apname ON wifi_data_aplocations (apname)"
        );

        await conn.query(
            "CREATE TABLE IF NOT EXISTS rwth_gym (id INT AUTO_INCREMENT PRIMARY KEY, auslastung INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
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
            )`
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
