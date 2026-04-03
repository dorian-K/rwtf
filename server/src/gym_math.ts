export interface GymDataPiece {
    auslastung: number;
    created_at: string;
}

export interface GymDataFullWeek {
    days: GymDataPiece[][];
    weight: number;
}

interface WeightedDayData {
    data: GymDataPiece[];
    weight: number;
}

// Get day of week from a date string (0 = Sunday, 1 = Monday, etc.)
function getDayOfWeek(dateStr: string): number {
    return new Date(dateStr).getDay();
}

function normalizeDataToTimeOfDay(data: GymDataPiece[], minX = new Date().setHours(6, 0, 0, 0)) {
    return data
        .map((g) => {
            const gDate = new Date(g.created_at);
            return {
                ...g,
                created_at: new Date(minX).setHours(
                    gDate.getHours(),
                    gDate.getMinutes(),
                    gDate.getSeconds(),
                    gDate.getMilliseconds()
                ),
            };
        })
        .sort((a, b) => a.created_at - b.created_at);
}

function makeDayKey(dateStr: string) {
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function flattenWeeksToDays(gymHist: GymDataFullWeek[]): WeightedDayData[] {
    return gymHist.flatMap((week) =>
        week.days
            .filter((day) => day.length > 0)
            .map((day) => ({
                data: day,
                weight: week.weight,
            }))
    );
}

function getDaysForWeekday(gymHist: GymDataFullWeek[], dayOfWeek: number): WeightedDayData[] {
    return flattenWeeksToDays(gymHist).filter(
        (day) => day.data.length > 0 && getDayOfWeek(day.data[0].created_at) === dayOfWeek
    );
}

function averageDays(dayData: WeightedDayData[], useMedian = false) {
    const minX = new Date().setHours(6, 0, 0, 0);
    const maxX = new Date().setHours(23, 59, 59, 999);
    const historicAvg = [];
    const historicData = dayData.map((day) => ({
        data: normalizeDataToTimeOfDay(day.data, minX),
        weight: day.weight,
    }));

    const hrs = Math.round((maxX - minX) / (1000 * 60 * 60));
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
                    const value = a.auslastung + x * (b.auslastung - a.auslastung);
                    values.push(value);
                    weights.push(weight);
                    totalWeight += weight;
                }
            } else if (nextTime === 0) {
                if (Math.abs(day[nextTime].created_at - time) < 1000 * 60 * 15) {
                    values.push(day[nextTime].auslastung);
                    weights.push(weight);
                    totalWeight += weight;
                }
            } else if (nextTime === day.length) {
                if (Math.abs(day[nextTime - 1].created_at - time) < 1000 * 60 * 15) {
                    values.push(day[nextTime - 1].auslastung);
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

        historicAvg.push({ created_at: time, auslastung: avgValue });
    }

    return historicAvg;
}

function getCurrentDayData(currentWeek: GymDataFullWeek, currentDayOfWeek: number): GymDataPiece[] {
    const matchingDay = currentWeek.days.find(
        (day) => day.length > 0 && getDayOfWeek(day[0].created_at) === currentDayOfWeek
    );
    return matchingDay ?? [];
}

function makeAverageLine(gymHist: GymDataFullWeek[], currentDayOfWeek: number, useMedian = false) {
    return averageDays(getDaysForWeekday(gymHist, currentDayOfWeek), useMedian);
}

function makeDayOfWeekLine(gymHist: GymDataFullWeek[], currentDayOfWeek: number) {
    const filteredData = getDaysForWeekday(gymHist, currentDayOfWeek);
    if (filteredData.length === 0) {
        return averageDays(flattenWeeksToDays(gymHist));
    }

    return averageDays(filteredData);
}

function makeClosestLine(gymHist: GymDataFullWeek[], currentWeek: GymDataFullWeek, currentDayOfWeek: number) {
    const MINIMUM_COMPARE_POINTS = 6;
    const DIFFERENT_WEEKDAY_WEIGHT_FACTOR = 2;
    const currentDayData = getCurrentDayData(currentWeek, currentDayOfWeek);

    if (currentDayData.length < MINIMUM_COMPARE_POINTS || gymHist.length <= 3) {
        return makeAverageLine(gymHist, currentDayOfWeek);
    }

    const minX = new Date().setHours(6, 0, 0, 0);
    const normalizedCurrentDay = normalizeDataToTimeOfDay(currentDayData, minX);
    const candidateDays = flattenWeeksToDays(gymHist);

    const distances = candidateDays.map((candidateDay) => {
        let totalError = 0;
        let pointsCompared = 0;
        let lastHistIndex = 0;

        if (candidateDay.data.length < MINIMUM_COMPARE_POINTS) {
            return { day: candidateDay, distance: Infinity };
        }

        const normalizedHistoricalDay = normalizeDataToTimeOfDay(candidateDay.data, minX);
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
                    interpolatedValue = a.auslastung + x * (b.auslastung - a.auslastung);
                }
            }

            interpolatedVals.push(interpolatedValue);
        }

        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < normalizedCurrentDay.length; i++) {
            const y = normalizedCurrentDay[i].auslastung;
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
            const y = normalizedCurrentDay[i].auslastung;
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
                    auslastung: d.auslastung * m,
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

    return averageDays(closestDays);
}

function buildFullWeek(data: GymDataPiece[], weight: number): GymDataFullWeek {
    const dayMap = new Map<string, GymDataPiece[]>();

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
            day.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
        ),
        weight,
    };
}

export { buildFullWeek, makeAverageLine, makeClosestLine, makeDayOfWeekLine };