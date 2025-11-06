export interface GymDataPiece {
    auslastung: number;
    created_at: string;
}
export interface GymDataWeek {
    data: GymDataPiece[];
    weight: number;
}

// This function averages multiple weeks of gym data into a single average line (with weights)
function makeAverageLine(gym_hist: GymDataWeek[]) {
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
        let avg = 0;
        let count = 0;
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
                    avg += weight * (a.auslastung + x * (b.auslastung - a.auslastung));
                    count += weight;
                }
            } else if (nextTime === 0) {
                if (Math.abs(week[nextTime].created_at - time) < 1000 * 60 * 15) {
                    avg += weight * week[nextTime].auslastung;
                    count += weight;
                }
            } else if (nextTime === week.length) {
                if (Math.abs(week[nextTime - 1].created_at - time) < 1000 * 60 * 15) {
                    avg += weight * week[nextTime - 1].auslastung;
                    count += weight;
                }
            }
            lastVals[w] = nextTime;
        }
        if (count > 0) {
            avg /= count;
        }
        historicAvg.push({ created_at: time, auslastung: avg });
    }
    return historicAvg;
}

// First find the three most similar weeks to the current week, then average those
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

        if (week.data.length < 2 || data_of_current_day.length < 1) {
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

            if (interpolatedValue !== null) {
                const error = currentPoint.auslastung - interpolatedValue;
                total_error += error * error;
                points_compared++;
            }
        }

        const mse =
            points_compared >= MINIMUM_COMPARE_POINTS ? total_error / points_compared : Infinity;
        return { week: week, distance: mse };
    });

    // sort the weeks by distance and take the three best ones
    const sortedWeeks = distances.sort((a, b) => a.distance - b.distance);
    const closestWeeks = sortedWeeks.slice(0, 3).map((d) => ({
        ...d.week,
        weight: 1, // give them equal weight
    }));

    if (closestWeeks.length === 0) {
        return [];
    }

    // average the three best weeks
    return makeAverageLine(closestWeeks);
}

export { makeAverageLine, makeClosestLine };
