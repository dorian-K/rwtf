import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import ipRangeCheck from "ip-range-check";

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

const OS_TEMP = "/tmp/studydrive/";

if (!fs.existsSync(OS_TEMP)) {
    fs.mkdirSync(OS_TEMP);
}

async function downloadStudyAuthenticated(url: string) {
    //const url = `https://www.studydrive.net/document/${docId}`;
    const response = await fetch(url, {
        headers: FETCH_HEADERS,
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        redirect: "follow",
    });
    const rText = await response.text();

    let fileName = /display_file_name":"(.*?)"/.exec(rText)![1];
    let dlUrl = /file_preview":"(.*?)"/.exec(rText)![1].replace("\\", "");

    if (!fileName || !dlUrl) {
        throw new Error("Failed to fetch file");
    }

    if (["/", "\\", ":", "*", "?", '"', "<", ">", "|"].some((c) => fileName.includes(c))) {
        throw new Error("Invalid file name");
    }

    fileName += ".pdf";

    const savePath = path.join(OS_TEMP, `${fileName}`);
    if (!savePath.startsWith(OS_TEMP)) {
        console.error("Invalid file path", savePath, fileName);
        throw new Error("Invalid file path");
    }

    if (fs.existsSync(savePath)) {
        console.log("File already exists");
        return savePath;
    }

    const rawCookies = response.headers.raw()["set-cookie"];
    const cookies = rawCookies.map((cookie) => cookie.split(";")[0]).join("; ");

    const fileResponse = await fetch(dlUrl, {
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        redirect: "follow",
        headers: {
            ...FETCH_HEADERS,
            cookie: cookies,
        },
    });

    // stream save file
    const dest = fs.createWriteStream(savePath);
    fileResponse.body?.pipe(dest);
    // wait for file to be saved
    console.log("Downloading file...");
    await new Promise((resolve) => {
        dest.on("finish", resolve);
    });
    console.log("Downloaded file to", savePath);

    return savePath;
}

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

async function downloadStudyFunky(origUrl: string) {
    // check cache
    if (cachedFiles[origUrl] && fs.existsSync(cachedFiles[origUrl])) {
        console.log("Loaded from cache");
        return cachedFiles[origUrl];
    }

    // extract id
    if (!origUrl.startsWith("https://www.studydrive.net")) {
        throw new Error("Invalid url");
    }
    const docId = origUrl.split("/").pop()!.split("?")[0];
    if (!docId) {
        throw new Error("Invalid url");
    }
    const url = `https://www.studydrive.net/document/${docId}`;
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
        throw new Error("Failed to fetch file, missing data");
    }
    let name = data["filename"];
    let ending = name.split(".").pop();
    let preview = data["file_preview"];
    let token = preview.split("token=").pop();
    let dlUrl = `https://cdn.studydrive.net/d/prod/documents/${docId}/original/${docId}.${ending}?token=${token}`;

    const savePath = path.join(OS_TEMP, `${name}`);
    if (!savePath.startsWith(OS_TEMP)) {
        console.error("Invalid file path", savePath, name);
        throw new Error("Invalid file path");
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
        dest.on("finish", resolve);
    });
    console.log("Downloaded file to", savePath);

    // cache
    cachedFiles[origUrl] = savePath;

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
    ];
    const ip = req.ip;
    if (!ip) {
        return false;
    }
    if (!IP_RANGES.some((range) => ipRangeCheck(ip, range))) {
        // check cache first
        if (invalid_ip_ranges.some((range) => ipRangeCheck(ip, range))) {
            return false;
        }
        if (!valid_ip_ranges.some((range) => ipRangeCheck(ip, range))) {
            const resp = await fetch(`https://ipapi.co/${ip}/json/`);
            const js: any = await resp.json();
            //console.log(js);
            if (js.error) {
                //res.status(403).send({ error: true, msg: "Invalid IP" });
                return false;
            }
            if (js.city !== "Aachen") {
                //res.status(403).send({ error: true, msg: "Invalid IP" });
                // add to invalid list
                invalid_ip_ranges.push(ip + "/16");
                if (invalid_ip_ranges.length > 1000) {
                    invalid_ip_ranges.shift();
                }
                return false;
            }
            // add to valid list
            valid_ip_ranges.push(ip + "/16");
            if (valid_ip_ranges.length > 1000) {
                valid_ip_ranges.shift();
            }

            //console.log("Valid IP", ip);
        } else {
            //console.log("Loaded from cache");
        }
    } else {
        //console.log("Valid IP in hardcoded", ip);
    }

    return true;
}

// GET /api/v1/study?url=https://www.studydrive.net/document/1234
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
        console.error(err);
        res.status(500).send({ error: true, msg: "Failed to download file" });
    }
}
