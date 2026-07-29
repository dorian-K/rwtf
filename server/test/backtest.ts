// Backtest harness for the gym day-prediction engine.
//
// Replays `predictLine` "as of" past cutoff times across every well-covered historical day, exactly
// mirroring live use: history from prior weeks plus today's partial curve up to the cutoff, with a
// strict no-leakage guard (never feeds samples after the cutoff into the predictor). For each future
// target time it records the prediction, the current spread-based bands, and the eventual actual.
//
// It then calibrates an empirical *conformal* band from residuals on one fold of days and measures
// coverage + pinball loss on a disjoint fold — for both the current bands and the conformal bands —
// so we can see, on real data, whether conformal intervals are better calibrated.
//
// Run against a locally published DB:  DB_HOST=127.0.0.1 node dist/test/backtest.js

import pool from "../src/db.js";
import { buildFullWeek, predictLine, FullWeek, DayWindow, PredictedPoint } from "../src/prediction.js";

const GYM_WINDOW: DayWindow = { startHour: 6, endHour: 24 };
const NUM_WEEKS = 120; // matches the live route
const CUTOFF_HOURS = [8, 11, 14, 17, 20]; // wall-clock times we pretend "now" is
const MIN_DAY_POINTS = 100; // only evaluate days with decent coverage
const HORIZON_BIN_MIN = 60; // conformal residual bins, in minutes
const MAX_HORIZON_BIN = 17; // cap (window is 18h wide)

interface Piece {
    value: number;
    created_at: Date;
}
interface Record {
    dayIdx: number;
    horizon: number; // minutes ahead of cutoff
    todMin: number; // target time-of-day in minutes
    pred: number;
    curLo: number;
    curHi: number;
    curLoW: number;
    curHiW: number;
    actual: number;
}

function dayKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function todMinutes(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}

function quantile(sortedAsc: number[], q: number): number {
    if (sortedAsc.length === 0) return 0;
    if (q <= 0) return sortedAsc[0];
    if (q >= 1) return sortedAsc[sortedAsc.length - 1];
    const pos = (sortedAsc.length - 1) * q;
    const lo = Math.floor(pos);
    const frac = pos - lo;
    return sortedAsc[lo] + frac * (sortedAsc[lo + 1] - sortedAsc[lo]);
}

// Interpolate a day's actual curve at an arbitrary time-of-day (minutes). Null outside its span.
function makeActualInterp(day: Piece[]): (todMin: number) => number | null {
    const pts = day
        .map((p) => ({ t: todMinutes(p.created_at), v: p.value }))
        .sort((a, b) => a.t - b.t);
    return (todMin: number) => {
        if (pts.length === 0 || todMin < pts[0].t || todMin > pts[pts.length - 1].t) return null;
        let i = 0;
        while (i < pts.length && pts[i].t < todMin) i++;
        if (i === 0) return pts[0].v;
        const a = pts[i - 1];
        const b = pts[i];
        if (b.t === a.t) return a.v;
        const x = (todMin - a.t) / (b.t - a.t);
        return a.v + x * (b.v - a.v);
    };
}

// Build the weeks array as of `cutoff` on day D, from the pre-bucketed day map. Excludes any sample
// after the cutoff (leakage guard): future days in D's own week are dropped, D's day is truncated.
function buildWeeksAsOf(
    dayMap: Map<string, Piece[]>,
    D: Date,
    cutoff: Date,
): FullWeek[] {
    const currentDayOfWeek = D.getDay();
    const dKey = dayKey(D);
    const weeks: FullWeek[] = [];
    for (let i = 0; i <= NUM_WEEKS; i++) {
        const weekDate = new Date(D);
        weekDate.setDate(weekDate.getDate() - i * 7);
        const startDate = new Date(weekDate);
        startDate.setDate(startDate.getDate() - currentDayOfWeek);
        startDate.setHours(0, 0, 0, 0);

        const pieces: Piece[] = [];
        for (let dOff = 0; dOff < 7; dOff++) {
            const day = new Date(startDate);
            day.setDate(day.getDate() + dOff);
            if (day > D) continue; // future day within the in-progress week
            const k = dayKey(day);
            const dayPieces = dayMap.get(k);
            if (!dayPieces) continue;
            for (const p of dayPieces) {
                if (k === dKey && p.created_at > cutoff) continue; // truncate today at the cutoff
                pieces.push(p);
            }
        }

        if (i > 60 && pieces.length < 20) break;
        weeks.push(buildFullWeek(pieces, i <= 4 ? 3 : 1));
    }
    return weeks;
}

function pinball(actual: number, qhat: number, tau: number): number {
    const u = actual - qhat;
    return u >= 0 ? tau * u : (tau - 1) * u;
}

async function main() {
    const conn = await pool.getConnection();
    console.log("loading gym rows...");
    const rows: any[] = await conn.query(
        "SELECT auslastung AS value, created_at FROM rwth_gym ORDER BY created_at ASC",
    );
    conn.end();
    console.log(`loaded ${rows.length} rows`);

    const dayMap = new Map<string, Piece[]>();
    for (const r of rows) {
        const created = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
        const p: Piece = { value: Number(r.value), created_at: created };
        const k = dayKey(created);
        const arr = dayMap.get(k);
        if (arr) arr.push(p);
        else dayMap.set(k, [p]);
    }

    // Candidate eval days: well-covered, and old enough to have history behind them.
    const evalDays: Date[] = [];
    for (const [, pieces] of dayMap) {
        if (pieces.length < MIN_DAY_POINTS) continue;
        const d = new Date(pieces[0].created_at);
        d.setHours(0, 0, 0, 0);
        evalDays.push(d);
    }
    evalDays.sort((a, b) => a.getTime() - b.getTime());
    // Drop the earliest 8 weeks — too little history behind them to be representative.
    const firstUsable = new Date(evalDays[0]);
    firstUsable.setDate(firstUsable.getDate() + 56);
    const usableDays = evalDays.filter((d) => d >= firstUsable);
    console.log(`evaluating ${usableDays.length} well-covered days x ${CUTOFF_HOURS.length} cutoffs`);

    const records: Record[] = [];
    let done = 0;
    for (let di = 0; di < usableDays.length; di++) {
        const D = usableDays[di];
        const actualInterp = makeActualInterp(dayMap.get(dayKey(D))!);
        for (const H of CUTOFF_HOURS) {
            const cutoff = new Date(D);
            cutoff.setHours(H, 0, 0, 0);
            const weeks = buildWeeksAsOf(dayMap, D, cutoff);
            let predicted: PredictedPoint[];
            try {
                predicted = predictLine(weeks, D.getDay(), GYM_WINDOW);
            } catch {
                continue;
            }
            for (const p of predicted) {
                const todMin = todMinutes(new Date(p.created_at));
                const horizon = todMin - H * 60;
                if (horizon <= 0) continue; // only score the forecast (future) part
                const actual = actualInterp(todMin);
                if (actual === null) continue;
                records.push({
                    dayIdx: di,
                    horizon,
                    todMin,
                    pred: p.value,
                    curLo: p.lower,
                    curHi: p.upper,
                    curLoW: p.lowerWide,
                    curHiW: p.upperWide,
                    actual,
                });
            }
        }
        done++;
        if (done % 50 === 0) console.log(`  ...${done}/${usableDays.length} days`);
    }
    console.log(`collected ${records.length} forecast points\n`);

    // Fold split by day index (interleaved so both folds span all seasons).
    const calib = records.filter((r) => r.dayIdx % 2 === 0);
    const test = records.filter((r) => r.dayIdx % 2 === 1);

    // Calibrate conformal residual quantiles per key. Returns lookups for the 4 quantile levels,
    // with a global fallback for sparse bins.
    function calibrate(keyOf: (r: Record) => number) {
        const byKey = new Map<number, number[]>();
        const all: number[] = [];
        for (const r of calib) {
            const res = r.actual - r.pred;
            all.push(res);
            const k = keyOf(r);
            const arr = byKey.get(k);
            if (arr) arr.push(res);
            else byKey.set(k, [res]);
        }
        all.sort((a, b) => a - b);
        const sortedByKey = new Map<number, number[]>();
        for (const [k, arr] of byKey) sortedByKey.set(k, arr.slice().sort((a, b) => a - b));
        const globalQ = (q: number) => quantile(all, q);
        return (r: Record, q: number): number => {
            const arr = sortedByKey.get(keyOf(r));
            if (!arr || arr.length < 40) return globalQ(q);
            return quantile(arr, q);
        };
    }

    const horizonKey = (r: Record) => Math.min(Math.floor(r.horizon / HORIZON_BIN_MIN), MAX_HORIZON_BIN);
    const todKey = (r: Record) => Math.floor(r.todMin / 180); // 3-hour time-of-day buckets
    const horizonTodKey = (r: Record) => horizonKey(r) * 100 + todKey(r);

    function evaluate(name: string, qOf: (r: Record, q: number) => number) {
        let cov50 = 0;
        let cov90 = 0;
        let width50 = 0;
        let width90 = 0;
        let pb25 = 0;
        let pb75 = 0;
        for (const r of test) {
            const lo50 = Math.max(0, Math.min(100, r.pred + qOf(r, 0.25)));
            const hi50 = Math.max(0, Math.min(100, r.pred + qOf(r, 0.75)));
            const lo90 = Math.max(0, Math.min(100, r.pred + qOf(r, 0.05)));
            const hi90 = Math.max(0, Math.min(100, r.pred + qOf(r, 0.95)));
            if (r.actual >= lo50 && r.actual <= hi50) cov50++;
            if (r.actual >= lo90 && r.actual <= hi90) cov90++;
            width50 += hi50 - lo50;
            width90 += hi90 - lo90;
            pb25 += pinball(r.actual, lo50, 0.25);
            pb75 += pinball(r.actual, hi50, 0.75);
        }
        const n = test.length;
        console.log(
            `  ${name.padEnd(22)} cov50=${((cov50 / n) * 100).toFixed(1)}%  cov90=${(
                (cov90 / n) *
                100
            ).toFixed(1)}%  w50=${(width50 / n).toFixed(1)}  w90=${(width90 / n).toFixed(1)}  ` +
                `pinball(.25/.75)=${(pb25 / n).toFixed(3)}/${(pb75 / n).toFixed(3)}`,
        );
    }

    // Current spread-based bands, evaluated on the same test fold.
    let cCov50 = 0;
    let cCov100 = 0;
    let cW50 = 0;
    let cW100 = 0;
    let cPb25 = 0;
    let cPb75 = 0;
    for (const r of test) {
        if (r.actual >= r.curLo && r.actual <= r.curHi) cCov50++;
        if (r.actual >= r.curLoW && r.actual <= r.curHiW) cCov100++;
        cW50 += r.curHi - r.curLo;
        cW100 += r.curHiW - r.curLoW;
        cPb25 += pinball(r.actual, r.curLo, 0.25);
        cPb75 += pinball(r.actual, r.curHi, 0.75);
    }
    const n = test.length;
    console.log(`test points: ${n}   (target: cov50=50%, cov90=90%)\n`);
    console.log("CURRENT (spread-of-pool bands):");
    console.log(
        `  inner 50% band        cov=${((cCov50 / n) * 100).toFixed(1)}%  w=${(cW50 / n).toFixed(
            1,
        )}  pinball(.25/.75)=${(cPb25 / n).toFixed(3)}/${(cPb75 / n).toFixed(3)}`,
    );
    console.log(
        `  outer 100% band       cov=${((cCov100 / n) * 100).toFixed(1)}%  w=${(cW100 / n).toFixed(1)}`,
    );
    console.log("\nCONFORMAL (residual bands):");
    evaluate("by horizon", calibrate(horizonKey));
    evaluate("by horizon+tod", calibrate(horizonTodKey));

    // Coverage of the horizon-keyed conformal 50% band, broken out per horizon bin, to expose any
    // remaining heteroscedastic miscalibration.
    console.log("\nper-horizon-bin coverage (conformal by horizon, 50% band):");
    const qOf = calibrate(horizonKey);
    const binCov = new Map<number, { hit: number; n: number }>();
    for (const r of test) {
        const lo = Math.max(0, Math.min(100, r.pred + qOf(r, 0.25)));
        const hi = Math.max(0, Math.min(100, r.pred + qOf(r, 0.75)));
        const b = horizonKey(r);
        const e = binCov.get(b) ?? { hit: 0, n: 0 };
        e.n++;
        if (r.actual >= lo && r.actual <= hi) e.hit++;
        binCov.set(b, e);
    }
    for (const b of [...binCov.keys()].sort((a, z) => a - z)) {
        const e = binCov.get(b)!;
        const lo = b * HORIZON_BIN_MIN;
        console.log(
            `  ${lo}-${lo + HORIZON_BIN_MIN}min ahead: cov50=${((e.hit / e.n) * 100).toFixed(
                1,
            )}%  (n=${e.n})`,
        );
    }

    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
