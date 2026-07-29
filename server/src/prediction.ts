// Generic time-series day-prediction engine.
//
// Extracted from the original gym predictor so it can be reused for any metric that is a single
// numeric value sampled over time (gym occupancy, WiFi devices per building, …). The only domain
// coupling left here is the shape { value, created_at }; callers adapt their own field names.
//
// The `DayWindow` controls which part of the day is predicted: the gym only operates 06:00–24:00,
// whereas WiFi runs the full 24 h. Everything else (weighting, interpolation, closest-match) is
// identical to the original gym implementation.

export interface TimeSeriesPiece {
    value: number;
    // Accepts anything `new Date()` understands (ISO string, Date, or epoch ms). Prediction lines
    // emit epoch-ms numbers here, matching the original gym behaviour.
    created_at: any;
}

export interface FullWeek {
    days: TimeSeriesPiece[][];
    weight: number;
}

export interface DayWindow {
    startHour: number; // inclusive, e.g. 6 for the gym
    endHour: number; // exclusive, e.g. 24 for end-of-day
}

export const FULL_DAY: DayWindow = { startHour: 0, endHour: 24 };

// A predicted point carries the central estimate plus two empirical confidence bands derived from
// the spread of the most-similar historical days at that time: a tight inner band (`lower`/`upper`,
// the middle 50%) and the full outer envelope (`lowerWide`/`upperWide`, min–max of the pool).
export interface PredictedPoint {
    created_at: number;
    value: number;
    lower: number;
    upper: number;
    lowerWide: number;
    upperWide: number;
}

// Tuning knobs (env-overridable for offline sweeps). Defaults were tuned against the as-of backtest
// (test/sweep.ts) over the full ~2.3-year gym history (480k causal forecast points): this config
// cuts point-forecast MAE by ~4.9% vs the original (12.78 -> 12.15) while keeping the bands
// well-calibrated (inner ~48% coverage, outer ~90%). Every prediction stays causal and the method
// still needs no retraining or extra storage -- these are inference-time constants only.
const envNum = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
// How many of the closest historical days to pool for the prediction + bands. Drives the outer
// (min-max) band's width, hence its coverage; RANK_DECAY keeps the far ranks from blurring the mean.
const CLOSEST_POOL_SIZE = envNum("POOL_SIZE", 18);
// Clamp on the per-day linear scale factor that rescales a historical day to today's level.
const MIN_SCALE = envNum("MIN_SCALE", 0.5);
const MAX_SCALE = envNum("MAX_SCALE", 1.25);
// Multiplicative distance penalty applied to candidate days on a different weekday. High enough that
// the pool is dominated by same-weekday days, but finite so off-weekday days still fill sparse pools.
const WEEKDAY_PENALTY = envNum("WEEKDAY_PENALTY", 8);
// Emphasis on the recent (later-in-day) portion of today's observed curve when scoring similarity.
// 0 = uniform; >0 linearly up-weights points closer to the current time, on the theory that the most
// recently observed behavior best predicts the immediate future.
const MATCH_TAIL = envNum("MATCH_TAIL", 3);
// Exponent on the rank-decaying pool weight (1 = linear POOL-rank; >1 sharpens the center line toward
// the best matches). Decoupled from the outer band, which uses min-max and ignores these weights.
const RANK_DECAY = envNum("RANK_DECAY", 3);
// Inner band = middle 50% (inter-quartile). The outer band uses the 0/1 quantiles (min–max).
const BAND_INNER_LOWER_QUANTILE = 0.25;
const BAND_INNER_UPPER_QUANTILE = 0.75;

interface WeightedDayData {
    data: TimeSeriesPiece[];
    weight: number;
}

// Get day of week from a date value (0 = Sunday, 1 = Monday, etc.)
function getDayOfWeek(dateStr: any): number {
    return new Date(dateStr).getDay();
}

// Reference midnight (today) used as the base date when collapsing all samples onto one day.
function dayBase(): number {
    return new Date().setHours(0, 0, 0, 0);
}

function normalizeDataToTimeOfDay(data: TimeSeriesPiece[], base: number) {
    return data
        .map((g) => {
            const gDate = new Date(g.created_at);
            return {
                ...g,
                created_at: new Date(base).setHours(
                    gDate.getHours(),
                    gDate.getMinutes(),
                    gDate.getSeconds(),
                    gDate.getMilliseconds(),
                ),
            };
        })
        .sort((a, b) => a.created_at - b.created_at);
}

function makeDayKey(dateStr: any) {
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function flattenWeeksToDays(hist: FullWeek[]): WeightedDayData[] {
    return hist.flatMap((week) =>
        week.days
            .filter((day) => day.length > 0)
            .map((day) => ({
                data: day,
                weight: week.weight,
            })),
    );
}

function getDaysForWeekday(hist: FullWeek[], dayOfWeek: number): WeightedDayData[] {
    return flattenWeeksToDays(hist).filter(
        (day) => day.data.length > 0 && getDayOfWeek(day.data[0].created_at) === dayOfWeek,
    );
}

// Weighted quantile with linear interpolation between the two samples straddling the target
// cumulative weight. `values`/`weights` need not be pre-sorted. Returns 0 for empty input.
function weightedQuantile(values: number[], weights: number[], q: number): number {
    if (values.length === 0) return 0;
    const pairs = values.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v);
    const totalWeight = pairs.reduce((s, p) => s + p.w, 0);
    if (totalWeight <= 0) return pairs[Math.floor((pairs.length - 1) * q)].v;

    const target = q * totalWeight;
    let cum = 0;
    for (let i = 0; i < pairs.length; i++) {
        const prevCum = cum;
        cum += pairs[i].w;
        if (cum >= target) {
            if (i === 0) return pairs[0].v;
            // Interpolate within this sample's weight span from the previous sample, for a smooth edge.
            const frac = pairs[i].w > 0 ? (target - prevCum) / pairs[i].w : 0;
            return pairs[i - 1].v + frac * (pairs[i].v - pairs[i - 1].v);
        }
    }
    return pairs[pairs.length - 1].v;
}

function averageDays(dayData: WeightedDayData[], window: DayWindow): PredictedPoint[] {
    const base = dayBase();
    const minX = new Date(base).setHours(window.startHour, 0, 0, 0);
    const hrs = window.endHour - window.startHour;
    const historicAvg: PredictedPoint[] = [];
    const historicData = dayData.map((day) => ({
        data: normalizeDataToTimeOfDay(day.data, base),
        weight: day.weight,
    }));

    const lastVals = new Array(historicData.length).fill(0);
    for (let min = 0; min < hrs * 60; min += 5) {
        const time = +new Date(minX + min * 60 * 1000);
        const values: number[] = [];
        const weights: number[] = [];
        let totalWeight = 0;

        for (let w = 0; w < historicData.length; w++) {
            const day = historicData[w].data;
            const weight = historicData[w].weight;
            if (day.length < 2) {
                continue;
            }

            let nextTime = lastVals[w];
            while (nextTime < day.length && day[nextTime].created_at < time) {
                nextTime++;
            }

            if (nextTime > 0 && nextTime < day.length) {
                const a = day[nextTime - 1];
                const b = day[nextTime];
                const x = (time - a.created_at) / (b.created_at - a.created_at);
                if (x < 0 || x > 1) {
                    console.error("x out of bounds", x);
                } else {
                    const value = a.value + x * (b.value - a.value);
                    values.push(value);
                    weights.push(weight);
                    totalWeight += weight;
                }
            } else if (nextTime === 0) {
                if (Math.abs(day[nextTime].created_at - time) < 1000 * 60 * 15) {
                    values.push(day[nextTime].value);
                    weights.push(weight);
                    totalWeight += weight;
                }
            } else if (nextTime === day.length) {
                if (Math.abs(day[nextTime - 1].created_at - time) < 1000 * 60 * 15) {
                    values.push(day[nextTime - 1].value);
                    weights.push(weight);
                    totalWeight += weight;
                }
            }

            lastVals[w] = nextTime;
        }

        let avgValue = 0;
        let lower = 0;
        let upper = 0;
        let lowerWide = 0;
        let upperWide = 0;
        if (values.length > 0) {
            for (let i = 0; i < values.length; i++) {
                avgValue += weights[i] * values[i];
            }
            avgValue /= totalWeight;

            // Two empirical bands from the spread of the pooled days at this bucket: a tight 50%
            // (inter-quartile) band and the full 100% (min–max) envelope.
            lower = weightedQuantile(values, weights, BAND_INNER_LOWER_QUANTILE);
            upper = weightedQuantile(values, weights, BAND_INNER_UPPER_QUANTILE);
            lowerWide = weightedQuantile(values, weights, 0);
            upperWide = weightedQuantile(values, weights, 1);
            // The inner band must contain the central estimate; the outer must contain the inner.
            lower = Math.min(lower, avgValue);
            upper = Math.max(upper, avgValue);
            lowerWide = Math.min(lowerWide, lower);
            upperWide = Math.max(upperWide, upper);
        }

        historicAvg.push({ created_at: time, value: avgValue, lower, upper, lowerWide, upperWide });
    }

    return historicAvg;
}

function getCurrentDayData(currentWeek: FullWeek, currentDayOfWeek: number): TimeSeriesPiece[] {
    const matchingDay = currentWeek.days.find(
        (day) => day.length > 0 && getDayOfWeek(day[0].created_at) === currentDayOfWeek,
    );
    return matchingDay ?? [];
}

function makeAverageLine(hist: FullWeek[], currentDayOfWeek: number, window: DayWindow = FULL_DAY) {
    return averageDays(getDaysForWeekday(hist, currentDayOfWeek), window);
}

function makeClosestLine(
    hist: FullWeek[],
    currentWeek: FullWeek,
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
) {
    const MINIMUM_COMPARE_POINTS = 6;
    const DIFFERENT_WEEKDAY_WEIGHT_FACTOR = WEEKDAY_PENALTY;
    const currentDayData = getCurrentDayData(currentWeek, currentDayOfWeek);

    if (currentDayData.length < MINIMUM_COMPARE_POINTS || hist.length <= 3) {
        return makeAverageLine(hist, currentDayOfWeek, window);
    }

    const base = dayBase();
    const normalizedCurrentDay = normalizeDataToTimeOfDay(currentDayData, base);
    const candidateDays = flattenWeeksToDays(hist);

    const distances = candidateDays.map((candidateDay) => {
        let totalError = 0;
        let pointsCompared = 0;
        let lastHistIndex = 0;

        if (candidateDay.data.length < MINIMUM_COMPARE_POINTS) {
            return { day: candidateDay, distance: Infinity };
        }

        const normalizedHistoricalDay = normalizeDataToTimeOfDay(candidateDay.data, base);
        const interpolatedVals = [];

        for (const currentPoint of normalizedCurrentDay) {
            const time = currentPoint.created_at;
            let interpolatedValue = null;

            while (
                lastHistIndex < normalizedHistoricalDay.length &&
                normalizedHistoricalDay[lastHistIndex].created_at < time
            ) {
                lastHistIndex++;
            }

            if (lastHistIndex > 0 && lastHistIndex < normalizedHistoricalDay.length) {
                const a = normalizedHistoricalDay[lastHistIndex - 1];
                const b = normalizedHistoricalDay[lastHistIndex];
                const x = (time - a.created_at) / (b.created_at - a.created_at);

                if (x >= 0 && x <= 1) {
                    interpolatedValue = a.value + x * (b.value - a.value);
                }
            }

            interpolatedVals.push(interpolatedValue);
        }

        // Per-point weight: 1 for uniform matching, ramping up to 1+MATCH_TAIL for the most recent
        // observed point (index tracks time-of-day since normalizedCurrentDay is time-sorted).
        const lastIdx = Math.max(1, normalizedCurrentDay.length - 1);
        const pointWeight = (i: number) => 1 + MATCH_TAIL * (i / lastIdx);

        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < normalizedCurrentDay.length; i++) {
            const y = normalizedCurrentDay[i].value;
            const x = interpolatedVals[i];
            if (x !== null) {
                const wpt = pointWeight(i);
                sumXY += wpt * x * y;
                sumXX += wpt * x * x;
            }
        }

        let m = sumXX > 0 ? sumXY / sumXX : 1;
        m = Math.min(m, MAX_SCALE);
        m = Math.max(m, MIN_SCALE);

        let weightSum = 0;
        for (let i = 0; i < normalizedCurrentDay.length; i++) {
            const y = normalizedCurrentDay[i].value;
            const x = interpolatedVals[i];
            if (x !== null) {
                const wpt = pointWeight(i);
                const predictedY = m * x;
                const error = y - predictedY;
                totalError += wpt * error * error;
                weightSum += wpt;
                pointsCompared++;
            }
        }

        let mse = Infinity;
        if (
            pointsCompared >= MINIMUM_COMPARE_POINTS &&
            pointsCompared >= normalizedCurrentDay.length * 0.8 - 1
        ) {
            mse = totalError / weightSum;
        }
        mse /= candidateDay.weight;

        const historicalDayOfWeek = getDayOfWeek(candidateDay.data[0].created_at);
        if (historicalDayOfWeek !== currentDayOfWeek) {
            mse *= DIFFERENT_WEEKDAY_WEIGHT_FACTOR;
        }

        return {
            day: {
                data: candidateDay.data.map((d) => ({
                    ...d,
                    value: d.value * m,
                })),
                weight: candidateDay.weight,
            },
            distance: mse,
        };
    });

    // Pool the closest matches (dropping days we couldn't score), then weight them by rank so the
    // center line still favors the best matches while the band spans the whole pool.
    const ranked = distances
        .filter((d) => isFinite(d.distance))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, CLOSEST_POOL_SIZE);

    if (ranked.length === 0) {
        return makeAverageLine(hist, currentDayOfWeek, window);
    }

    const closestDays = ranked.map((d, rank) => ({
        data: d.day.data,
        weight: Math.pow(CLOSEST_POOL_SIZE - rank, RANK_DECAY),
    }));

    return averageDays(closestDays, window);
}

function buildFullWeek(data: TimeSeriesPiece[], weight: number): FullWeek {
    const dayMap = new Map<string, TimeSeriesPiece[]>();

    for (const point of data) {
        const key = makeDayKey(point.created_at);
        const existing = dayMap.get(key);
        if (existing) {
            existing.push(point);
        } else {
            dayMap.set(key, [point]);
        }
    }

    return {
        days: Array.from(dayMap.values()).map((day) =>
            day.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        ),
        weight,
    };
}

// Predict the day's curve with the "closest weeks" method: compare today (weeks[0], the in-progress
// week) against history (weeks[1..]), average the most-similar days, and attach an empirical band.
function predictLine(
    weeks: FullWeek[],
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
): PredictedPoint[] {
    return makeClosestLine(weeks.slice(1), weeks[0], currentDayOfWeek, window);
}

export {
    buildFullWeek,
    makeAverageLine,
    makeClosestLine,
    getCurrentDayData,
    predictLine,
};
