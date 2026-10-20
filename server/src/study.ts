import fetch from "node-fetch";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import ipRangeCheck from "ip-range-check";
import { getConnection } from "./db.js";
import { isAachenIp } from "./geoip.js";
import type { PoolConnection } from "mariadb";

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

interface CachedFile {
    path: string;
    filename: string;
}

const cachedFiles: { [url: string]: CachedFile } = {};
// housekeeping
setInterval(
    () => {
        const keys = Object.keys(cachedFiles);
        for (const key of keys) {
            if (!fs.existsSync(cachedFiles[key].path)) {
                delete cachedFiles[key];
            }
        }
    },
    1000 * 60 * 60,
);

// `code` is a stable machine-readable tag so the frontend can render a tailored message instead of
// echoing raw backend prose.
type UserErrorCode = "invalid_url" | "unavailable" | "unknown_type" | "upstream";

class UserError extends Error {
    code: UserErrorCode;

    constructor(message: string, code: UserErrorCode = "unavailable") {
        super(message);
        this.code = code;
    }
}

// The remote filename is untrusted and ends up both in the CDN URL and in a local path, so only a
// plain alphanumeric suffix is usable. Names without a dot ("Übungsblatt 0 - ... WiSe 2025/26")
// would otherwise yield an "extension" containing a slash, pointing the write stream at a
// directory that doesn't exist. Returns null when the name carries no usable extension.
function extensionFromName(filename: string): string | null {
    const dot = filename.lastIndexOf(".");
    const ext = dot > 0 ? filename.slice(dot + 1) : "";
    return /^[a-zA-Z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : null;
}

// Extensions worth probing when the filename doesn't carry one, most likely first. The CDN URL is
// built from the extension, so there is no way to ask — we have to try. Ordered by what actually
// shows up on StudyDrive (lecture notes and past exams are overwhelmingly PDFs).
const GUESSED_EXTENSIONS = [
    "pdf",
    "docx",
    "pptx",
    "apkg", // Anki decks
    "jpg",
    "png",
    "zip",
    "xlsx",
    "txt",
];

// Pause between extension probes. Only ever paid when we're guessing, and only between attempts —
// a document whose filename has an extension still resolves in a single request.
const GUESS_DELAY_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Ordered list of extensions to try for a document: the filename's own extension if it has one,
// otherwise anything we can read out of the preview URL (it points at the same document id and
// often keeps the original suffix), then the common-format guesses.
function extensionCandidates(filename: string, previewUrl: string, docId: string): string[] {
    const fromName = extensionFromName(filename);
    if (fromName) {
        return [fromName];
    }

    const candidates: string[] = [];
    const fromPreview = new RegExp(`${docId}\\.([a-zA-Z0-9]{1,10})`).exec(previewUrl);
    if (fromPreview) {
        candidates.push(fromPreview[1].toLowerCase());
    }
    for (const ext of GUESSED_EXTENSIONS) {
        if (!candidates.includes(ext)) {
            candidates.push(ext);
        }
    }
    return candidates;
}

// Cache path for a document. docId comes from the last URL segment so it can't contain a slash,
// but the extension is only ever one of our validated candidates — keep the containment check as a
// backstop in case either assumption changes.
function localPath(docId: string, ext: string): string {
    const p = path.join(OS_TEMP, `${docId}.${ext}`);
    if (!p.startsWith(OS_TEMP)) {
        console.error("Invalid file path", p, docId, ext);
        throw new UserError("Invalid local file path", "invalid_url");
    }
    return p;
}

// Name the user's browser should save the file under: the original name, with the resolved
// extension appended when the name didn't carry one (which is exactly the case where we guessed).
function downloadName(filename: string, ext: string): string {
    const base = filename.trim() || "document";
    return extensionFromName(base) ? base : `${base}.${ext}`;
}

// Bump the per-file download counter (how often a file was fetched through our site). Fire and
// forget with its own connection, like saveAuslastung. No-op if the row doesn't exist yet.
function incrementDownloadCount(studyId: string) {
    let conn: PoolConnection;
    getConnection()
        .then((c) => {
            conn = c;
            return conn.query(
                "UPDATE studyfiles SET download_count = download_count + 1 WHERE study_id = ?",
                [studyId],
            );
        })
        .then(() => {
            conn.end();
        })
        .catch((err) => {
            console.error(err);
            if (conn) conn.end();
        });
}

async function downloadStudyFunky(origUrl: string): Promise<CachedFile> {
    // extract id
    if (!origUrl.startsWith(BASE_URL)) {
        throw new UserError("Invalid url, needs to start with " + BASE_URL, "invalid_url");
    }
    const docId = origUrl.split("/").pop()!.split("?")[0];
    if (!docId) {
        throw new UserError("Invalid url, could not extract document ID", "invalid_url");
    }

    // check cache
    if (cachedFiles[origUrl] && fs.existsSync(cachedFiles[origUrl].path)) {
        console.log("Loaded from cache");
        incrementDownloadCount(docId);
        return cachedFiles[origUrl];
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

    const data = jResp.data;
    if (!data || !Object.hasOwn(data, "filename") || !Object.hasOwn(data, "file_preview")) {
        throw new UserError("Failed to fetch file, missing data", "upstream");
    }
    const name = String(data.filename ?? "");
    const preview = String(data.file_preview ?? "");
    const token = preview.split("token=").pop();
    const candidates = extensionCandidates(name, preview, docId);

    // A cached copy from an earlier guess wins over re-probing the CDN.
    for (const ext of candidates) {
        const existing = localPath(docId, ext);
        if (fs.existsSync(existing)) {
            console.log("File already exists");
            incrementDownloadCount(docId);
            const cached = { path: existing, filename: downloadName(name, ext) };
            cachedFiles[origUrl] = cached;
            return cached;
        }
    }

    // Try each candidate extension until the CDN hands us the file. When the filename carried its
    // own extension this is a single request; otherwise we walk the guesses, spaced out so a
    // guessing run doesn't look like a burst of 404s from us.
    let fileResponse: Awaited<ReturnType<typeof fetch>> | null = null;
    let ending = "";
    for (const [i, ext] of candidates.entries()) {
        if (i > 0) {
            await sleep(GUESS_DELAY_MS);
        }
        const dlUrl = `https://cdn.${BASE}.net/d/prod/documents/${docId}/original/${docId}.${ext}?token=${token}`;
        const resp = await fetch(dlUrl, {
            referrerPolicy: "strict-origin-when-cross-origin",
            body: null,
            method: "GET",
            redirect: "follow",
            headers: FETCH_HEADERS,
        });
        // While guessing, a 200 isn't enough: a miss may come back as an HTML or JSON error page,
        // which we'd otherwise save and hand to the user as their "document".
        const type = resp.headers.get("content-type") ?? "";
        const looksLikeAnErrorPage =
            candidates.length > 1 && /^(text\/html|application\/json)/i.test(type);
        if (resp.ok && resp.body && !looksLikeAnErrorPage) {
            fileResponse = resp;
            ending = ext;
            break;
        }
        // Drain the rejected body so the socket can be reused instead of leaking.
        resp.body?.resume();
        if (candidates.length > 1) {
            console.log(
                `Extension guess .${ext} rejected (${resp.status}, ${type || "no type"}) for ${docId}`,
            );
        }
    }

    if (!fileResponse) {
        if (candidates.length > 1) {
            throw new UserError(
                "Could not determine the file type — this document has no file extension and " +
                    `none of the common formats (${GUESSED_EXTENSIONS.join(", ")}) matched`,
                "unknown_type",
            );
        }
        throw new UserError("The document could not be fetched from StudyDrive", "upstream");
    }

    const savePath = localPath(docId, ending);
    // stream save file. pipeline() propagates stream errors as a rejection — a raw pipe() would
    // emit an unhandled 'error' event and take the whole process down.
    console.log("Downloading file...");
    try {
        await streamPipeline(fileResponse.body!, fs.createWriteStream(savePath));
    } catch (err) {
        // don't leave a half-written file behind for the cache/existsSync checks to trip over
        await fsPromises.rm(savePath, { force: true }).catch(() => {});
        throw err;
    }
    console.log("Downloaded file to", savePath);

    // cache
    const result: CachedFile = { path: savePath, filename: downloadName(name, ending) };
    cachedFiles[origUrl] = result;

    // add to database
    let conn: PoolConnection;

    getConnection()
        .then((c) => {
            conn = c;
            return conn.query(
                "INSERT INTO studyfiles (path, study_id, filename, course_name, file_type, university_name, professor_name, semester_label, json_data, download_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    `${docId}.${ending}`,
                    docId,
                    name,
                    data.course_name ?? "",
                    data.file_type ?? -1,
                    data.university_name ?? "",
                    data.professor_name ?? "",
                    data.semester?.name ?? "",
                    JSON.stringify(data),
                    1,
                ],
            );
        })
        .then(() => {
            conn.end();
        })
        .catch((err) => {
            console.error(err);
            if (conn) conn.end();
        });

    return result;
}

// RWTH/private networks are allowed outright; anything else must geolocate to Aachen, using the
// offline DB-IP ranges (geoip.ts), so the visitor's IP is never sent to a third party.
const IP_RANGES = [
    "134.130.0.0/16",
    "137.226.0.0/16",
    "134.61.0.0/16",
    "2a00:8a60::/32",
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "::1/128",
    "89.0.0.0/15", // joergs ip, https://ipinfo.io/AS8422
];

export async function isAachener(req: Request, _res: Response) {
    const ip = req.ip;
    if (!ip) {
        return false;
    }
    return IP_RANGES.some((range) => ipRangeCheck(ip, range)) || isAachenIp(ip);
}

// Search the studyfiles metadata table with a free-text query over the human-readable columns.
// json_data is deliberately excluded from the result set (it's the full API blob per row) — the
// inspect route serves that. Pagination uses the LIMIT pageSize+1 overflow trick to compute
// has_more without a second COUNT query.
export async function searchStudyFiles(req: Request, res: Response) {
    if (!(await isAachener(req, res))) {
        res.status(403).send({ error: true, msg: "Invalid IP" });
        return;
    }

    const q = (req.query.q as string) ?? "";
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
    const pageSizeRaw = parseInt((req.query.page_size as string) ?? "20", 10) || 20;
    const pageSize = Math.min(50, Math.max(1, pageSizeRaw));

    // Whitelist sort → fixed ORDER BY string; never interpolate user input.
    // "downloads" = how often the file was fetched through our site (default).
    // "uploaded" = when the document was uploaded to StudyDrive (its json_data.created_at).
    const sortMap: { [key: string]: string } = {
        downloads: "download_count DESC",
        uploaded: "JSON_UNQUOTE(JSON_EXTRACT(json_data, '$.created_at')) DESC",
    };
    const orderBy =
        "ORDER BY " + (sortMap[(req.query.sort as string) ?? "downloads"] ?? sortMap.downloads);

    const clauses: string[] = [];
    const params: any[] = [];
    if (q) {
        const like = `%${q}%`;
        clauses.push(
            "(filename LIKE ? OR course_name LIKE ? OR professor_name LIKE ? " +
                "OR university_name LIKE ? OR semester_label LIKE ?)",
        );
        params.push(like, like, like, like, like);
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    let conn: PoolConnection | undefined;
    try {
        conn = await getConnection();
        // Our own created_at (when we first fetched the file) is intentionally NOT exposed. We
        // extract the StudyDrive upload date from json_data instead.
        const rows = await conn.query(
            `SELECT id, study_id, filename, course_name, file_type,
                    university_name, professor_name, semester_label, download_count,
                    JSON_UNQUOTE(JSON_EXTRACT(json_data, '$.created_at')) AS uploaded_at
             FROM studyfiles
             ${where}
             ${orderBy}
             LIMIT ? OFFSET ?`,
            [...params, pageSize + 1, (page - 1) * pageSize],
        );
        const hasMore = rows.length > pageSize;
        const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
        const results = pageRows.map((r: any) => ({
            ...r,
            downloadUrl: `${BASE_URL}/document/${r.study_id}`,
        }));
        res.json({
            error: false,
            results,
            page,
            page_size: pageSize,
            has_more: hasMore,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: true, msg: "Search failed" });
    } finally {
        if (conn) conn.end();
    }
}

// Return the full stored metadata for a single studyfile, including the parsed json_data blob so
// the frontend can render a curated set of fields. Looks up by the UNIQUE study_id (index hit).
export async function inspectStudyFile(req: Request, res: Response) {
    if (!(await isAachener(req, res))) {
        res.status(403).send({ error: true, msg: "Invalid IP" });
        return;
    }

    const studyId = req.query.study_id as string;
    if (!studyId) {
        res.status(400).send({ error: true, msg: "Missing study_id" });
        return;
    }

    let conn: PoolConnection | undefined;
    try {
        conn = await getConnection();
        const rows = await conn.query("SELECT * FROM studyfiles WHERE study_id = ? LIMIT 1", [
            studyId,
        ]);
        if (rows.length === 0) {
            res.status(404).send({ error: true, msg: "Not found" });
            return;
        }
        const row = rows[0];
        let metadata: any = null;
        try {
            metadata = JSON.parse(row.json_data);
        } catch {
            metadata = null;
        }
        res.json({
            error: false,
            file: {
                id: row.id,
                study_id: row.study_id,
                path: row.path,
                filename: row.filename,
                course_name: row.course_name,
                file_type: row.file_type,
                university_name: row.university_name,
                professor_name: row.professor_name,
                semester_label: row.semester_label,
                download_count: row.download_count,
                // StudyDrive's own upload date, from the stored blob.
                uploaded_at: metadata?.created_at ?? null,
                downloadUrl: `${BASE_URL}/document/${row.study_id}`,
            },
            metadata,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: true, msg: "Inspect failed" });
    } finally {
        if (conn) conn.end();
    }
}

export async function downloadStreamFile(req: Request, res: Response) {
    if (!(await isAachener(req, res))) {
        res.status(403).send({ error: true, code: "not_aachen", msg: "Invalid IP" });
        return;
    }

    const url = req.query.url as string;
    if (!url) {
        res.status(400).send({ error: true, code: "invalid_url", msg: "Missing url" });
        return;
    }

    try {
        const file = await downloadStudyFunky(url);
        // Without this the browser names the download after the route ("study"). Both forms are
        // sent: a plain ASCII fallback and the RFC 5987 encoding that keeps umlauts intact.
        const ascii = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        );
        res.sendFile(file.path);
    } catch (err) {
        if (err instanceof UserError) {
            res.status(400).send({ error: true, code: err.code, msg: err.message });
            return;
        }
        console.error(err);
        res.status(500).send({
            error: true,
            code: "internal",
            msg: "Something went wrong while fetching this file",
        });
    }
}

// housekeeping of files directory
setInterval(
    () => {
        console.log("Housekeeping");
        const files = fs.readdirSync(OS_TEMP);
        // total size should not exceed 50gb
        const filesStat = files.map((f) => fsPromises.stat(path.join(OS_TEMP, f)));
        Promise.all(filesStat)
            .then((stats) => {
                let totalSize = stats.reduce((acc, val) => acc + val.size, 0);
                if (totalSize > 50 * 1024 * 1024 * 1024 || files.length > 10000) {
                    // 50gb
                    // delete oldest files until size is below 40gb
                    const sorted = stats
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
    },
    1000 * 60 * 60,
); // every hour
