import express from "express";
import pool, { getConnection } from "./db.js";
import getAuslastungNumber from "./gym_crawler.js";
import { PoolConnection } from "mariadb";
const app = express();
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
app.get("/api/gym", async (req, res) => {
    let conn;
    try {
        conn = await getConnection();
        const rows = await conn.query(
            "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= NOW() - INTERVAL 1 DAY ORDER BY created_at DESC LIMIT 1000"
        );
        const sanitized = rows.map((row: any) => {
            return {
                auslastung: row.auslastung,
                created_at: row.created_at,
            };
        });
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        oneWeekAgo.setHours(0, 0, 0, 0);

        const oneWeekAgoEnd = new Date();
        oneWeekAgoEnd.setDate(oneWeekAgoEnd.getDate() - 7);
        oneWeekAgoEnd.setHours(23, 59, 59, 999);

        const rowsOneWeekAgo = await conn.query(
            "SELECT auslastung, created_at FROM rwth_gym WHERE created_at >= ? AND created_at <= ?",
            [oneWeekAgo, oneWeekAgoEnd]
        );
        // console.log(rowsOneWeekAgo);
        const sanitizedOneWeekAgo = rowsOneWeekAgo.map((row: any) => {
            return {
                auslastung: row.auslastung,
                created_at: row.created_at,
            };
        });

        res.json({ data: sanitized, data_lastweek: sanitizedOneWeekAgo });
    } catch (err) {
        console.error(err);
        res.status(500).send("{error: true}");
    } finally {
        if (conn) conn.end();
    }
});

app.get("/api", (req, res) => {
    res.send("Hello World!");
});

// init database
getConnection()
    .then((conn) => {
        return conn.query(
            "CREATE TABLE IF NOT EXISTS rwth_gym (id INT AUTO_INCREMENT PRIMARY KEY, auslastung INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        );
    })
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
