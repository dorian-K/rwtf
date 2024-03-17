import express from "express";
import pool, { getConnection } from "./db.js";
import getAuslastungNumber from "./gym_crawler.js";
import { PoolConnection } from "mariadb";
const app = express();
const port = 4000;

async function gymCrawl() {
    const num = await getAuslastungNumber();
    // console.log(num);

    // insert into db
    let conn: PoolConnection;
    getConnection()
        .then((c) => {
            conn = c;
            return conn.query("INSERT INTO rwth_gym (auslastung) VALUES (?)", [num]);
        })
        .then(() => {
            conn.end();
        })
        .catch((err) => {
            console.error(err);
            if (conn) conn.end();
        });
}
setInterval(gymCrawl, 1000 * 60 * 5); // 5 minutes
gymCrawl();

app.get("/api/gym", async (req, res) => {
    let conn;
    try {
        conn = await getConnection();
        const rows = await conn.query(
            "SELECT auslastung, created_at FROM rwth_gym ORDER BY created_at DESC LIMIT 1000"
        );
        const sanitized = rows.map((row: any) => {
            return {
                auslastung: row.auslastung,
                created_at: row.created_at,
            };
        });

        res.json({ data: sanitized });
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
