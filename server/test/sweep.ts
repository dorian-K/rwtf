// EXPERIMENT (not committed): sweep the current predictor's tuning knobs (via env, read in
// prediction.ts) against the as-of backtest. Every prediction is causal (past + today-so-far only),
// so MAE over the replay is already an out-of-sample forecast score -- no train/test split needed.

import pool from "../src/db.js";
import { buildFullWeek, predictLine, FullWeek, DayWindow, PredictedPoint } from "../src/prediction.js";

const GYM_WINDOW: DayWindow = { startHour: 6, endHour: 24 };
const NUM_WEEKS = 120;
const CUTOFF_HOURS = (process.env.CUTOFFS ?? "8,11,14,17,20").split(",").map(Number);
const MIN_DAY_POINTS = 100;
const SUBSAMPLE = Number(process.env.SUBSAMPLE ?? 4); // every Nth usable day

interface Piece { value: number; created_at: Date; }
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const tod = (d: Date) => d.getHours() * 60 + d.getMinutes();
function interp(day: Piece[]) {
    const pts = day.map((p) => ({ t: tod(p.created_at), v: p.value })).sort((a, b) => a.t - b.t);
    return (t: number): number | null => {
        if (pts.length === 0 || t < pts[0].t || t > pts[pts.length - 1].t) return null;
        let i = 0;
        while (i < pts.length && pts[i].t < t) i++;
        if (i === 0) return pts[0].v;
        const a = pts[i - 1], b = pts[i];
        return b.t === a.t ? a.v : a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v);
    };
}
function weeksAsOf(dayMap: Map<string, Piece[]>, D: Date, cutoff: Date): FullWeek[] {
    const cdow = D.getDay(), dk = dayKey(D), weeks: FullWeek[] = [];
    for (let i = 0; i <= NUM_WEEKS; i++) {
        const wd = new Date(D); wd.setDate(wd.getDate() - i * 7);
        const s = new Date(wd); s.setDate(s.getDate() - cdow); s.setHours(0, 0, 0, 0);
        const pieces: Piece[] = [];
        for (let o = 0; o < 7; o++) {
            const day = new Date(s); day.setDate(day.getDate() + o);
            if (day > D) continue;
            const dp = dayMap.get(dayKey(day)); if (!dp) continue;
            for (const p of dp) { if (dayKey(day) === dk && p.created_at > cutoff) continue; pieces.push(p); }
        }
        if (i > 60 && pieces.length < 20) break;
        weeks.push(buildFullWeek(pieces, i <= 4 ? 3 : 1));
    }
    return weeks;
}

async function main() {
    const conn = await pool.getConnection();
    const rows: any[] = await conn.query(
        "SELECT auslastung AS value, created_at FROM rwth_gym ORDER BY created_at ASC");
    conn.end();
    const dayMap = new Map<string, Piece[]>();
    for (const r of rows) {
        const c = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
        const k = dayKey(c); (dayMap.get(k) ?? dayMap.set(k, []).get(k)!).push({ value: Number(r.value), created_at: c });
    }
    const evalDays: Date[] = [];
    for (const [, ps] of dayMap) {
        if (ps.length < MIN_DAY_POINTS) continue;
        const d = new Date(ps[0].created_at); d.setHours(0, 0, 0, 0); evalDays.push(d);
    }
    evalDays.sort((a, b) => a.getTime() - b.getTime());
    const fu = new Date(evalDays[0]); fu.setDate(fu.getDate() + 56);
    const days = evalDays.filter((d) => d >= fu).filter((_, i) => i % SUBSAMPLE === 0);

    let absErr = 0, n = 0, cov50 = 0, cov90 = 0;
    for (const D of days) {
        const f = interp(dayMap.get(dayKey(D))!);
        for (const H of CUTOFF_HOURS) {
            const cutoff = new Date(D); cutoff.setHours(H, 0, 0, 0);
            let pred: PredictedPoint[];
            try { pred = predictLine(weeksAsOf(dayMap, D, cutoff), D.getDay(), GYM_WINDOW); } catch { continue; }
            for (const p of pred) {
                const t = tod(new Date(p.created_at));
                if (t - H * 60 <= 0) continue;
                const a = f(t); if (a === null) continue;
                absErr += Math.abs(p.value - a); n++;
                if (a >= p.lower && a <= p.upper) cov50++;
                if (a >= p.lowerWide && a <= p.upperWide) cov90++;
            }
        }
    }
    // Fallback literals mirror the compiled defaults in prediction.ts (shown when a knob is unset).
    const cfg = `POOL=${process.env.POOL_SIZE ?? 18} MINs=${process.env.MIN_SCALE ?? 0.5} ` +
        `MAXs=${process.env.MAX_SCALE ?? 1.25} WDpen=${process.env.WEEKDAY_PENALTY ?? 8} ` +
        `TAIL=${process.env.MATCH_TAIL ?? 3} RANK=${process.env.RANK_DECAY ?? 3}`;
    console.log(`${cfg} | MAE=${(absErr / n).toFixed(3)} cov50=${((cov50 / n) * 100).toFixed(1)}% ` +
        `cov90=${((cov90 / n) * 100).toFixed(1)}% n=${n}`);
    await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
