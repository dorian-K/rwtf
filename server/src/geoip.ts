// Offline "is this IP in Aachen?" lookup for the study-material gate, so visitor IPs never leave
// the server. Built from DB-IP's free IP-to-City Lite database (CC BY 4.0, https://db-ip.com):
// the monthly CSV is streamed once, only the Aachen ranges are kept (a few hundred), and those are
// cached on disk and refreshed monthly.

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import ipaddr from "ipaddr.js";

const CACHE_FILE = path.join(process.env.GEOIP_DIR ?? "./geoip", "aachen-ranges.json");
const MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000; // DB-IP publishes monthly
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Cache {
    builtAt: number;
    source: string;
    v4: [string, string][]; // inclusive [start, end], as decimal strings (JSON has no bigint)
    v6: [string, string][];
}

// Sorted, non-overlapping ranges per family, as bigints for binary search.
let ranges: { v4: [bigint, bigint][]; v6: [bigint, bigint][] } | undefined;
let builtAt = 0;

function toBigInt(addr: ipaddr.IPv4 | ipaddr.IPv6): bigint {
    return addr.toByteArray().reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
}

// DB-IP names Aachen addresses by district too, e.g. "Aachen (Mitte)" (where RWTH's ranges are).
const isAachenCity = (city: string) => city === "Aachen" || city.startsWith("Aachen (");

// Minimal CSV field split: DB-IP quotes fields that contain commas, never escapes quotes inside.
function splitCsv(line: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i <= line.length) {
        if (line[i] === '"') {
            const end = line.indexOf('"', i + 1);
            out.push(line.slice(i + 1, end));
            i = end + 2;
        } else {
            const end = line.indexOf(",", i);
            const stop = end === -1 ? line.length : end;
            out.push(line.slice(i, stop));
            i = stop + 1;
        }
    }
    return out;
}

// Stream a DB-IP city CSV (gzipped) and keep the Aachen ranges.
export async function parseAachenRanges(gz: Readable): Promise<Pick<Cache, "v4" | "v6">> {
    const v4: [string, string][] = [];
    const v6: [string, string][] = [];
    const lines = readline.createInterface({ input: gz.pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
        // ip_start,ip_end,continent,country,stateprov,city,latitude,longitude
        if (!line.includes("Aachen")) continue; // cheap pre-filter for 7M+ lines
        const [start, end, , country, , city] = splitCsv(line);
        if (country !== "DE" || !isAachenCity(city)) continue;
        const a = ipaddr.parse(start);
        const range: [string, string] = [
            toBigInt(a).toString(),
            toBigInt(ipaddr.parse(end)).toString(),
        ];
        (a.kind() === "ipv4" ? v4 : v6).push(range);
    }
    return { v4, v6 };
}

async function download(): Promise<Cache> {
    // This month's file appears a few days into the month; fall back to last month's.
    const now = new Date();
    for (const back of [0, 1]) {
        const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.csv.gz`;
        const res = await fetch(url);
        if (!res.ok || !res.body) continue;
        const parsed = await parseAachenRanges(Readable.fromWeb(res.body as any));
        return { builtAt: Date.now(), source: url, ...parsed };
    }
    throw new Error("no DB-IP city database available");
}

function load(cache: Cache) {
    const conv = (rs: [string, string][]) =>
        rs
            .map(([a, b]): [bigint, bigint] => [BigInt(a), BigInt(b)])
            .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    ranges = { v4: conv(cache.v4), v6: conv(cache.v6) };
    builtAt = cache.builtAt;
}

// Load the cached ranges, downloading a fresh database if missing or older than a month.
// Errors are logged; until ranges are loaded, isAachenIp() answers false.
export async function refreshGeoip() {
    try {
        if (!ranges) {
            const cached = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Cache;
            load(cached);
        }
    } catch {
        // no usable cache yet
    }
    if (ranges && Date.now() - builtAt < MAX_AGE_MS) return;
    try {
        const started = Date.now();
        const fresh = await download();
        await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(fresh));
        load(fresh);
        console.log(
            `geoip: ${fresh.v4.length + fresh.v6.length} Aachen ranges from ${fresh.source}` +
                ` in ${Date.now() - started} ms`,
        );
    } catch (err: any) {
        console.error("geoip refresh failed:", err.message);
    }
}

export function startGeoip() {
    refreshGeoip();
    setInterval(refreshGeoip, CHECK_INTERVAL_MS);
}

export function isAachenIp(ip: string): boolean {
    if (!ranges || !ipaddr.isValid(ip)) return false;
    const addr = ipaddr.process(ip); // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> IPv4
    const list = addr.kind() === "ipv4" ? ranges.v4 : ranges.v6;
    const x = toBigInt(addr);
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (x < list[mid][0]) hi = mid - 1;
        else if (x > list[mid][1]) lo = mid + 1;
        else return true;
    }
    return false;
}
