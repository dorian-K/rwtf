import fetch from "node-fetch";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { Request, Response } from "express";
import ipRangeCheck from "ip-range-check";
import { getConnection } from "./db.js";
import { PoolConnection } from "mariadb";

const FETCH_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9,de;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    priority: "u=0, i",
    "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
};

const OS_TEMP = "/tmp/study_files/";

if (!fs.existsSync(OS_TEMP)) {
    fs.mkdirSync(OS_TEMP);
}

const BASE_URL = Buffer.from("aHR0cHM6Ly93d3cuc3R1ZHlkcml2ZS5uZXQ=", "base64").toString("utf-8");
const BASE = Buffer.from("c3R1ZHlkcml2ZQ==", "base64").toString("utf-8");

const cachedFiles: { [url: string]: string } = {};
// housekeeping
setInterval(() => {
    const keys = Object.keys(cachedFiles);
    for (let key of keys) {
        if (!fs.existsSync(cachedFiles[key])) {
            delete cachedFiles[key];
        }
    }
}, 1000 * 60 * 60);

class UserError extends Error {
  constructor(message: string) {
    super(message)
  }
}

async function downloadStudyFunky(origUrl: string) {
    // check cache
    if (cachedFiles[origUrl] && fs.existsSync(cachedFiles[origUrl])) {
        console.log("Loaded from cache");
        return cachedFiles[origUrl];
    }

    // extract id
    if (!origUrl.startsWith(BASE_URL)) {
        throw new UserError("Invalid url, needs to start with " + BASE_URL);
    }
    const docId = origUrl.split("/").pop()!.split("?")[0];
    if (!docId) {
        throw new UserError("Invalid url, could not extract document ID");
    }
    const url = `${BASE_URL}/document/${docId}`;
    const response = await fetch(url, {
        headers: {
            ...FETCH_HEADERS,
            "X-Requested-With": "XMLHttpRequest",
        },
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        redirect: "follow",
    });
    const jResp = (await response.json()) as any;

    let data = jResp["data"];
    if (!data.hasOwnProperty("filename") || !data.hasOwnProperty("file_preview")) {
        throw new UserError("Failed to fetch file, missing data");
    }
    let name = data["filename"];
    let ending = name.split(".").pop();
    let preview = data["file_preview"];
    let token = preview.split("token=").pop();
    let dlUrl = `https://cdn.${BASE}.net/d/prod/documents/${docId}/original/${docId}.${ending}?token=${token}`;

    const savePath = path.join(OS_TEMP, `${docId}.${ending}`);
    if (!savePath.startsWith(OS_TEMP)) {
        console.error("Invalid file path", savePath, name);
        throw new UserError("Invalid local file path");
    }

    if (fs.existsSync(savePath)) {
        console.log("File already exists");
        return savePath;
    }

    const fileResponse = await fetch(dlUrl, {
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        redirect: "follow",
        headers: FETCH_HEADERS,
    });

    // stream save file
    const dest = fs.createWriteStream(savePath);
    fileResponse.body?.pipe(dest);
    // wait for file to be saved
    console.log("Downloading file...");
    await new Promise((resolve) => {
        dest.on("finish", () => resolve(null));
    });
    console.log("Downloaded file to", savePath);

    // cache
    cachedFiles[origUrl] = savePath;

    // add to database
    let conn: PoolConnection;

    getConnection()
        .then((c) => {
            conn = c;
            return conn.query(
                "INSERT INTO studyfiles (path, study_id, filename, course_name, file_type, university_name, professor_name, semester_label, json_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    `${docId}.${ending}`,
                    docId,
                    name,
                    data["course_name"] ?? "",
                    data["file_type"] ?? -1,
                    data["university_name"] ?? "",
                    data["professor_name"] ?? "",
                    data["semester"]["name"] ?? "",
                    JSON.stringify(data),
                ]
            );
        })
        .then(() => {
            conn.end();
        })
        .catch((err) => {
            console.error(err);
            if (conn) conn.end();
        });

    return savePath;
}

let valid_ip_ranges: string[] = [];
let invalid_ip_ranges: string[] = [];

export async function isAachener(req: Request, res: Response) {
    // check if ip in allowed list
    const IP_RANGES = [
        "134.130.0.0/16",
        "137.226.0.0/16",
        "134.61.0.0/16",
        "2a00:8a60::/32",
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "::1/128",
        "62.155.192.0/20" // Joerg's home IP
    ];
    const ip = req.ip;
    if (!ip) {
        return false;
    }
    if (!IP_RANGES.some((range) => ipRangeCheck(ip, range))) {
        // check cache first
        if (invalid_ip_ranges.some((range) => ipRangeCheck(ip, range))) {
            //console.log("Invalid IP", ip, "in invalid list");
            return false;
        }
        if (!valid_ip_ranges.some((range) => ipRangeCheck(ip, range))) {
            const resp = await fetch(`https://ipapi.co/${ip}/json/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0'
                }
            });
            const js: any = await resp.json();
            //console.log(js);
            if (js.error) {
                //console.log(js);
                //res.status(403).send({ error: true, msg: "Invalid IP" });
                return false;
            }
            if (js.city !== "Aachen") {
                console.log("Invalid city", js.city, "for IP", ip);
                //res.status(403).send({ error: true, msg: "Invalid IP" });
                // add to invalid list
                invalid_ip_ranges.push(js.network);
                if (invalid_ip_ranges.length > 1000) {
                    invalid_ip_ranges.shift();
                }
                return false;
            }
            // add to valid list
            if (js.version === "IPv6") {
                valid_ip_ranges.push(js.network);
            } else {
                valid_ip_ranges.push(js.network);
            }

            if (valid_ip_ranges.length > 1000) {
                valid_ip_ranges.shift();
            }

            console.log("Valid IP", ip);
        } else {
            //console.log("Loaded from cache");
        }
    } else {
        //console.log("Valid IP in hardcoded", ip);
    }

    return true;
}

export async function downloadStreamFile(req: Request, res: Response) {
    if (!isAachener(req, res)) {
        res.status(403).send({ error: true, msg: "Invalid IP" });
        return;
    }

    const url = req.query.url as string;
    if (!url) {
        res.status(400).send({ error: true, msg: "Missing url" });
        return;
    }

    try {
        const filePath = await downloadStudyFunky(url);
        res.sendFile(filePath);
    } catch (err) {
        if (err instanceof UserError) {
            res.status(400).send({ error: true, msg: "Failed to download file: " + err.message });
            return;
        }
        console.error(err);
        res.status(500).send({ error: true, msg: "Failed to download file" });
    }
}

// housekeeping of files directory
setInterval(() => {
    console.log("Housekeeping");
    let files = fs.readdirSync(OS_TEMP);
    // total size should not exceed 50gb
    let filesStat = files.map((f) => fsPromises.stat(path.join(OS_TEMP, f)));
    Promise.all(filesStat)
        .then((stats) => {
            let totalSize = stats.reduce((acc, val) => acc + val.size, 0);
            if (totalSize > 50 * 1024 * 1024 * 1024 || files.length > 10000) {
                // 50gb
                // delete oldest files until size is below 40gb
                let sorted = stats
                    .map((s, i) => ({ atime: s.atimeMs, size: s.size, file: files[i] }))
                    .sort((a, b) => a.atime - b.atime);
                let i = 0;
                while (totalSize > 40 * 1024 * 1024 * 1024 || files.length - i > 10000) {
                    // 40gb
                    fs.unlinkSync(path.join(OS_TEMP, sorted[i].file));
                    // remove from cache
                    delete cachedFiles[sorted[i].file];
                    totalSize -= sorted[i].size;
                    i++;
                }
            }
            console.log("Housekeeping done");
        })
        .catch((err) => {
            console.error(err);
        });
}, 1000 * 60 * 60); // every hour
