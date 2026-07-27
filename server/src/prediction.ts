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

export type PredictionMethod = "closest" | "average" | "median" | "dayofweek";

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

function averageDays(dayData: WeightedDayData[], window: DayWindow, useMedian = false) {
    const base = dayBase();
    const minX = new Date(base).setHours(window.startHour, 0, 0, 0);
    const hrs = window.endHour - window.startHour;
    const historicAvg = [];
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
        if (values.length > 0) {
            if (useMedian) {
                const weightedValues = values.map((v, i) => ({ v, w: weights[i] }));
                weightedValues.sort((a, b) => a.v - b.v);

                let cumWeight = 0;
                const halfWeight = totalWeight / 2;
                for (const item of weightedValues) {
                    cumWeight += item.w;
                    if (cumWeight >= halfWeight) {
                        avgValue = item.v;
                        break;
                    }
                }
            } else {
                for (let i = 0; i < values.length; i++) {
                    avgValue += weights[i] * values[i];
                }
                avgValue /= totalWeight;
            }
        }

        historicAvg.push({ created_at: time, value: avgValue });
    }

    return historicAvg;
}

function getCurrentDayData(currentWeek: FullWeek, currentDayOfWeek: number): TimeSeriesPiece[] {
    const matchingDay = currentWeek.days.find(
        (day) => day.length > 0 && getDayOfWeek(day[0].created_at) === currentDayOfWeek,
    );
    return matchingDay ?? [];
}

function makeAverageLine(
    hist: FullWeek[],
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
    useMedian = false,
) {
    return averageDays(getDaysForWeekday(hist, currentDayOfWeek), window, useMedian);
}

function makeDayOfWeekLine(
    hist: FullWeek[],
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
) {
    const filteredData = getDaysForWeekday(hist, currentDayOfWeek);
    if (filteredData.length === 0) {
        return averageDays(flattenWeeksToDays(hist), window);
    }

    return averageDays(filteredData, window);
}

function makeClosestLine(
    hist: FullWeek[],
    currentWeek: FullWeek,
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
) {
    const MINIMUM_COMPARE_POINTS = 6;
    const DIFFERENT_WEEKDAY_WEIGHT_FACTOR = 2;
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

        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < normalizedCurrentDay.length; i++) {
            const y = normalizedCurrentDay[i].value;
            const x = interpolatedVals[i];
            if (x !== null) {
                sumXY += x * y;
                sumXX += x * x;
            }
        }

        let m = sumXX > 0 ? sumXY / sumXX : 1;
        m = Math.min(m, 1.25);
        m = Math.max(m, 0.5);

        for (let i = 0; i < normalizedCurrentDay.length; i++) {
            const y = normalizedCurrentDay[i].value;
            const x = interpolatedVals[i];
            if (x !== null) {
                const predictedY = m * x;
                const error = y - predictedY;
                totalError += error * error;
                pointsCompared++;
            }
        }

        let mse = Infinity;
        if (
            pointsCompared >= MINIMUM_COMPARE_POINTS &&
            pointsCompared >= normalizedCurrentDay.length * 0.8 - 1
        ) {
            mse = totalError / pointsCompared;
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

    const closestDays = distances
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map((d) => ({
            data: d.day.data,
            weight: 1,
        }));

    if (closestDays.length === 0) {
        return [];
    }

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

// Dispatch to the requested prediction method, mirroring the original gym switch:
// "closest" compares today against history (week[0] is the in-progress week); the rest aggregate.
function predictLine(
    method: PredictionMethod,
    weeks: FullWeek[],
    currentDayOfWeek: number,
    window: DayWindow = FULL_DAY,
): TimeSeriesPiece[] {
    switch (method) {
        case "average":
            return makeAverageLine(weeks, currentDayOfWeek, window);
        case "median":
            return makeAverageLine(weeks, currentDayOfWeek, window, true);
        case "dayofweek":
            return makeDayOfWeekLine(weeks, currentDayOfWeek, window);
        case "closest":
        default:
            return makeClosestLine(weeks.slice(1), weeks[0], currentDayOfWeek, window);
    }
}

export {
    buildFullWeek,
    makeAverageLine,
    makeClosestLine,
    makeDayOfWeekLine,
    getCurrentDayData,
    predictLine,
};
