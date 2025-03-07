export interface GymDataPiece {
    auslastung: number;
    created_at: string;
}
export interface GymDataWeek {
    data: GymDataPiece[];
    weight: number;
}

export default function makeInterpLine(gym_hist: GymDataWeek[]) {
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
                        created_at: new Date(minX).setHours(gDate.getHours(), gDate.getMinutes(), gDate.getSeconds(), gDate.getMilliseconds()),
                    }
                })
                .sort((a, b) => a.created_at - b.created_at),
            weight: week.weight
        }
    }
    );


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
                    avg += weight *  week[nextTime].auslastung;
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