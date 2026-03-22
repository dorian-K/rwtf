export interface GymDataPiece {
    auslastung: number;
    created_at: string;
}
export interface GymDataWeek {
    data: GymDataPiece[];
    weight: number;
}

// Get day of week from a date string (0 = Sunday, 1 = Monday, etc.)
function getDayOfWeek(dateStr: string): number {
    return new Date(dateStr).getDay();
}

// This function averages multiple weeks of gym data into a single average line (with weights)
function makeAverageLine(gym_hist: GymDataWeek[], useMedian = false) {
    let minX = new Date().setHours(6, 0, 0, 0);
    let maxX = new Date().setHours(23, 59, 59, 999);
    let historicAvg = [];
    let historicData = gym_hist.map((week) => {
        return {
            data: week.data
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
                .sort((a, b) => a.created_at - b.created_at),
            weight: week.weight,
        };
    });

    // funny code to calculate historic average
    // this is complicated because the data is not aligned to a grid in the time dimension
    let hrs = Math.round((maxX - minX) / (1000 * 60 * 60));
    let lastVals = new Array(historicData.length).fill(0);
    for (let min = 0; min < hrs * 60; min += 5) {
        let time = +new Date(minX + min * 60 * 1000);
        let values: number[] = [];
        let weights: number[] = [];
        let totalWeight = 0;
        for (let w = 0; w < historicData.length; w++) {
            let week = historicData[w].data;
            let weight = historicData[w].weight;
            if (week.length < 2) {
                continue;
            }
            let nextTime = lastVals[w];
            while (nextTime < week.length && week[nextTime].created_at < time) {
                nextTime++;
            }
            // linear interpolation
            if (nextTime > 0 && nextTime < week.length) {
                const a = week[nextTime - 1];
                const b = week[nextTime];
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
                if (Math.abs(week[nextTime].created_at - time) < 1000 * 60 * 15) {
                    values.push(week[nextTime].auslastung);
                    weights.push(weight);
                    totalWeight += weight;
                }
            } else if (nextTime === week.length) {
                if (Math.abs(week[nextTime - 1].created_at - time) < 1000 * 60 * 15) {
                    values.push(week[nextTime - 1].auslastung);
                    weights.push(weight);
                    totalWeight += weight;
                }
            }
            lastVals[w] = nextTime;
        }
        
        let avgValue = 0;
        if (values.length > 0) {
            if (useMedian) {
                // Sort values by weight-adjusted value for weighted median
                const weightedValues = values.map((v, i) => ({ v, w: weights[i] }));
                weightedValues.sort((a, b) => a.v - b.v);
                // Find weighted median
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
                // Weighted average
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

// Average using only data from the same day of week as today
function makeDayOfWeekLine(gym_hist: GymDataWeek[], currentDayOfWeek: number) {
    let minX = new Date().setHours(6, 0, 0, 0);
    let maxX = new Date().setHours(23, 59, 59, 999);
    
    // Filter data to only include the same day of week
    const filteredData = gym_hist.map((week) => ({
        data: week.data.filter((g) => getDayOfWeek(g.created_at) === currentDayOfWeek),
        weight: week.weight,
    })).filter((week) => week.data.length > 0);
    
    if (filteredData.length === 0) {
        // Fall back to regular average if no data for this day
        return makeAverageLine(gym_hist);
    }
    
    return makeAverageLine(filteredData);
}

// First find the three most similar weeks to the current week, then average those
// We also try to align all the weeks to the current one by scaling it appropriately
function makeClosestLine(gym_hist: GymDataWeek[], data_of_current_day: GymDataPiece[]) {
    const MINIMUM_COMPARE_POINTS = 6;
    if (data_of_current_day.length < MINIMUM_COMPARE_POINTS || gym_hist.length <= 3) {
        return makeAverageLine(gym_hist);
    }

    // calculate the distance of every week to the current day
    const distances = gym_hist.map((week) => {
        let total_error = 0;
        let points_compared = 0;
        let lastHistIndex = 0;

        if (week.data.length < MINIMUM_COMPARE_POINTS || data_of_current_day.length < 1) {
            // dont use the week if it has too little data
            return { week: week, distance: Infinity };
        }

        // we need to normalize the time of day for both the historical and current data
        // to be able to compare them
        const minX = new Date().setHours(6, 0, 0, 0);
        const normalized_week_data = week.data
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

        const normalized_current_day = data_of_current_day
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

        // for every data point in the current day, we find the corresponding value in the historical week
        // by using linear interpolation. Then we calculate the squared error.
        let interpolatedVals = [];
        for (const currentPoint of normalized_current_day) {
            const time = currentPoint.created_at;
            let interpolatedValue = null;

            while (
                lastHistIndex < normalized_week_data.length &&
                normalized_week_data[lastHistIndex].created_at < time
            ) {
                lastHistIndex++;
            }

            if (lastHistIndex > 0 && lastHistIndex < normalized_week_data.length) {
                const a = normalized_week_data[lastHistIndex - 1];
                const b = normalized_week_data[lastHistIndex];
                const x = (time - a.created_at) / (b.created_at - a.created_at);

                if (x >= 0 && x <= 1) {
                    interpolatedValue = a.auslastung + x * (b.auslastung - a.auslastung);
                }
            }

            interpolatedVals.push(interpolatedValue);
        }
        // we have a list of interpolated values that align with our current day
        // now we do least squares regression with y = mx to align it as closely as possible to the current day
        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < normalized_current_day.length; i++) {
            const y = normalized_current_day[i].auslastung;
            const x = interpolatedVals[i];
            if (x !== null) {
                sumXY += x * y;
                sumXX += x * x;
            }
        }

        let m = sumXX > 0 ? sumXY / sumXX : 1;
        m = Math.min(m, 1.25);
        m = Math.max(m, 0.5);

        // now calculate the total squared error with the found m
        for (let i = 0; i < normalized_current_day.length; i++) {
            const y = normalized_current_day[i].auslastung;
            const x = interpolatedVals[i];
            if (x !== null) {
                const predictedY = m * x;
                const error = y - predictedY;
                total_error += error * error;
                points_compared++;
            }
        }       

        let mse = Infinity;
        if (points_compared >= MINIMUM_COMPARE_POINTS && points_compared >= normalized_current_day.length * 0.8 - 1) {
            mse = total_error / points_compared; // only consider weeks that have enough points compared
        }
        mse /= week.weight; // adjust by weight to prefer more reliable weeks

        // of course we also need to adjust the week data with the found m
        let adjustedWeek: GymDataWeek = {
            data: week.data.map((d) => ({
                ...d,
                auslastung: d.auslastung * m,
            })),
            weight: week.weight,
        };

        return { week: adjustedWeek, distance: mse };
    });

    // sort the weeks by distance and take the three best ones
    const sortedWeeks = distances.sort((a, b) => a.distance - b.distance);
    const closestWeeks = sortedWeeks.slice(0, 5).map((d) => ({
        ...d.week,
        weight: 1, // give them equal weight
    }));

    if (closestWeeks.length === 0) {
        return [];
    }

    // average the five best weeks
    return makeAverageLine(closestWeeks);
}

export { makeAverageLine, makeClosestLine, makeDayOfWeekLine };
