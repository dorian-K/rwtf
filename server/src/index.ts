import express from "express";
import pool, { getConnection } from "./db.js";
import getAuslastungNumber from "./gym_crawler.js";
import { PoolConnection } from "mariadb";
import { SAMPLE } from "./sample_data.js";
import { downloadStreamFile, isAachener } from "./study.js";
const app = express();
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
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

    if (dayoffset < 0 || dayoffset > 3 || isNaN(dayoffset)) {
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
            for (let i = 0; i <= 5; i++) {
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

app.get("/api/v1/study", downloadStreamFile);
app.get("/api/v1/is_aachen", async (req, res) => {
    if (await isAachener(req, res)) {
        res.json({ status: true });
    } else {
        res.json({ status: false });
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
            "CREATE TABLE IF NOT EXISTS rwth_gym (id INT AUTO_INCREMENT PRIMARY KEY, auslastung INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        );
        // index for created_at
        await conn.query("CREATE INDEX IF NOT EXISTS idx_created_at ON rwth_gym (created_at)");
        // other optimizations
        await conn.query("OPTIMIZE TABLE rwth_gym");
        await conn.query("ANALYZE TABLE rwth_gym");
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
    .then(database_init)
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
