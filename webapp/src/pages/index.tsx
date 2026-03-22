import { GymInterpLineResponse, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import { useEffect, useState } from "react";
import { EMBED_CODE } from "./embed_gym";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

function LiveStatusCard({ gym, gymLine }: { gym: GymResponse; gymLine: GymInterpLineResponse }) {
    // Current utilization
    const currentUtil = gym.data_today.length > 0 ? gym.data_today[gym.data_today.length - 1].auslastung : null;

    // Go / Wait decision
    const getGoWait = () => {
        if (currentUtil === null || !gymLine?.interpLine) return null;
        const nextHour = gymLine.interpLine[Math.min(12, gymLine.interpLine.length - 1)]?.auslastung || currentUtil;

        if (currentUtil < 40) {
            return { decision: "GO", emoji: "🏃", color: "success", text: "Perfect time!" };
        }
        if (currentUtil < 60 && nextHour < currentUtil) {
            return { decision: "GO", emoji: "🏃", color: "success", text: "Getting quieter!" };
        }
        return { decision: "WAIT", emoji: "⏰", color: "warning", text: "Busy right now" };
    };
    const goWait = getGoWait();

    // Quick time slots: Now, 1h, 2h
    const getTimeSlots = () => {
        if (!gymLine?.interpLine || gymLine.interpLine.length === 0) return [];
        const now = new Date();
        const slots = [];
        for (let i = 0; i <= 2; i++) {
            const target = new Date(now.getTime() + i * 3600000);
            const targetHour = target.getHours();
            let closest = gymLine.interpLine[0];
            let minDiff = 24;
            for (const p of gymLine.interpLine) {
                const diff = Math.abs(new Date(p.created_at).getHours() - targetHour);
                if (diff < minDiff) { minDiff = diff; closest = p; }
            }
            slots.push({ label: i === 0 ? "Now" : `${i}h`, value: closest?.auslastung || 0 });
        }
        return slots;
    };
    const timeSlots = getTimeSlots();

    // Find best time to go in next 3 hours
    const getBestTime = () => {
        if (!gymLine?.interpLine || gymLine.interpLine.length === 0) return null;
        const now = new Date();
        const threeHoursLater = new Date(now.getTime() + 3 * 3600000);
        let best = null;
        for (const p of gymLine.interpLine) {
            const ptTime = new Date(p.created_at);
            if (ptTime >= now && ptTime <= threeHoursLater) {
                if (!best || p.auslastung < best.value) {
                    best = { time: ptTime, value: p.auslastung };
                }
            }
        }
        return best;
    };
    const bestTime = getBestTime();

    // For people already at the gym: "How long until it gets crowded?"
    const getStayDuration = () => {
        if (currentUtil === null || !gymLine?.interpLine || currentUtil > 70) return null;
        const now = new Date();
        // Find when it hits 70% (uncomfortable)
        for (const p of gymLine.interpLine) {
            const ptTime = new Date(p.created_at);
            if (ptTime > now && p.auslastung >= 70) {
                const minsUntil = Math.round((ptTime.getTime() - now.getTime()) / 60000);
                return { until: ptTime, mins: minsUntil, value: p.auslastung };
            }
        }
        // Doesn't hit 70% in prediction window
        return { until: null, mins: 180, value: null };
    };
    const stayDuration = getStayDuration();

    const getStatusColor = (util: number) => {
        if (util < 40) return "text-success";
        if (util < 65) return "text-warning";
        return "text-danger";
    };

    const getMood = (util: number) => {
        if (util < 25) return "😌";
        if (util < 50) return "🙂";
        if (util < 75) return "😐";
        return "😰";
    };

    return (
        <div className="card bg-dark shadow-lg mb-3">
            {goWait && (
                <div className={`card-header bg-${goWait.color} text-white d-flex align-items-center justify-content-center py-2`}>
                    <span className="me-2" style={{fontSize: "1.5rem"}}>{goWait.emoji}</span>
                    <span className="h4 mb-0">{goWait.decision} - {goWait.text}</span>
                </div>
            )}
            <div className="card-body py-2">
                <div className="row text-center small">
                    {timeSlots.map((slot) => (
                        <div key={slot.label} className="col-4">
                            <div className="text-muted">{slot.label}</div>
                            <div className={`fw-bold ${getStatusColor(slot.value)}`}>{slot.value.toFixed(0)}%</div>
                            <div className="text-muted">{getMood(slot.value)}</div>
                        </div>
                    ))}
                </div>
                {bestTime && bestTime.value < 50 && (
                    <div className="mt-2 pt-2 border-top border-secondary text-center">
                        <small className="text-success">
                            💡 Best time: {bestTime.time.getHours()}:00 ({bestTime.value.toFixed(0)}%)
                        </small>
                    </div>
                )}
                {stayDuration && currentUtil !== null && currentUtil < 70 && (
                    <div className="mt-2 pt-2 border-top border-secondary text-center">
                        {stayDuration.until ? (
                            <small className="text-info">
                                ⏱️ You have ~{stayDuration.mins} min until crowded ({stayDuration.value.toFixed(0)}%)
                            </small>
                        ) : (
                            <small className="text-success">
                                ⏱️ Gym stays comfortable for ~3h
                            </small>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function ChartImpl({ gym, gymLine }: { gym: GymResponse; gymLine: GymInterpLineResponse }) {
    let todayReference;
    if (gym.data_today.length > 0) {
        todayReference = new Date(gym.data_today[0].created_at);
    } else if (
        gym.data_historic.length > 0 &&
        gym.data_historic[gym.data_historic.length - 1].length > 0
    ) {
        todayReference = new Date(gym.data_historic[gym.data_historic.length - 1][0].created_at);
    } else {
        return <div>No data</div>;
    }

    let adjustDate = (d: Date | string) => {
        if (typeof d === "string") {
            d = new Date(d);
        }
        d.setFullYear(
            todayReference.getFullYear(),
            todayReference.getMonth(),
            todayReference.getDate(),
        );
        return +d;
    };
    let data = gym.data_today.map((g) => ({
        ...g,
        created_at: Date.parse(g.created_at),
    }));
    data = data.sort((a, b) => a.created_at - b.created_at);

    let data_historic = gym.data_historic || [];
    let historicData = data_historic.map((week, index) =>
        week
            .map((g) => ({
                ...g,
                created_at: adjustDate(g.created_at),
            }))
            .sort((a, b) => a.created_at - b.created_at),
    );

    let minX = new Date(todayReference).setHours(6, 0, 0, 0);
    let maxX = new Date(todayReference).setHours(23, 59, 59, 999);

    const options: ApexOptions = {
        yaxis: {
            min: 0,
            max: (max) => Math.max(180, Math.ceil(max / 10) * 10),
            decimalsInFloat: 0,
            tickAmount: 6,
        },
        xaxis: {
            type: "datetime",
            min: minX,
            max: maxX,
            labels: {
                datetimeUTC: false,
            },
        },
        chart: {
            id: "gym",
            type: "area",
            animations: {
                enabled: false,
            },
        },
        dataLabels: {
            enabled: false,
        },
        stroke: {
            curve: "smooth",
            width: [3, 2, 2].concat(new Array(historicData.length).fill(1)),
            dashArray: [0, 1, 1].concat(new Array(historicData.length).fill(3)),
        },
        title: {
            text: "RWTH Gym Utilization",
            align: "left",
        },
        theme: {
            mode: "dark",
        },
        tooltip: {
            x: {
                format: "dd.MM.yyyy HH:mm",
            },
        },
        grid: {
            borderColor: "#636363",
            xaxis: {
                lines: {
                    show: true,
                },
            },
        },
        fill: {
            type: "solid",
            opacity: [0.4, 0.15, 0.15].concat(new Array(historicData.length).fill(0.02)),
        },
        annotations: {
            yaxis: [
                {
                    y: 160,
                    y2: 1000,
                    fillColor: "#FF0000",
                    opacity: 0.15,
                },
                {
                    y: 120,
                    y2: 160,
                    fillColor: "#ff8c00",
                    opacity: 0.15,
                },
            ],
            texts: [
                {
                    x: 200,
                    y: 100,
                    text: "https://rwtf.dorianko.ch/",
                    textAnchor: "start",
                    fontSize: "30px",
                    foreColor: "#888",
                },
            ],
        },
    };

    let historicArrivals = [];
    for (let i = 0; i < gymLine.interpLine.length; i++) {
        const g = gymLine.interpLine[i];
        let val = g.auslastung;
        let j = i - 1;
        let minTime = adjustDate(new Date(g.created_at)) - 1000 * 60 * 60 * 1.5; // 1.5 hrs
        while (j >= 0 && historicArrivals[j].created_at > minTime + 1000) {
            val -= Math.max(historicArrivals[j].arrival, 0);
            j--;
        }
        historicArrivals.push({
            created_at: adjustDate(new Date(g.created_at)),
            arrival: val,
        });
    }
    // smooth out the arrival data
    let smoothedArrivals = [];
    //smoothedArrivals.push(historicArrivals[0]);
    for (let i = 1; i < historicArrivals.length - 2; i++) {
        smoothedArrivals.push({
            created_at: historicArrivals[i].created_at,
            arrival:
                (historicArrivals[i - 1].arrival +
                    2 * historicArrivals[i].arrival +
                    historicArrivals[i + 1].arrival) /
                4,
        });
    }
    //smoothedArrivals.push(historicArrivals[historicArrivals.length - 1]);

    let series: ApexAxisChartSeries = [
        {
            name: "Utilization",
            zIndex: 1,
            data: data.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        },
        {
            name: "Prediction",
            data: gymLine.interpLine.map((g) => {
                const gDate = new Date(g.created_at);
                return {
                    x: adjustDate(gDate),
                    y: g.auslastung,
                };
            }),
        },
        {
            name: "Historic Arrival",
            data: smoothedArrivals.map((g) => ({
                x: g.created_at,
                y: g.arrival * (60 / 5), // correction factor
            })),
            hidden: true,
        },
    ];
    series = series.concat(
        historicData.map((week, index) => ({
            name: `${index + 1} Week(s) ago`,
            data: week.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
            hidden: true,
        })),
    );

    return (
        <ReactApexChart
            id="gymchart"
            type="area"
            width={"100%"}
            height={500}
            options={options}
            series={series}
        />
    );
}

export function GymPlotWithHandles({ hideHandles = false }: { hideHandles?: boolean }) {
    const [gym, setGym] = useState<GymResponse>();
    const [gymLine, setGymLine] = useState<GymInterpLineResponse>();
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const [predTime, setPredTime] = useState<string>("");

    const days = ["Today", "Tomorrow", "+2 days", "+3 days"];
    const [dayoffset, setDayoffset] = useState(0);
    const api = useBackendContext();

    // Get prediction for custom time
    const getPredictionForTime = (timeStr: string): { time: Date | null; value: number | null } => {
        if (!timeStr || !gymLine?.interpLine || gymLine.interpLine.length === 0) {
            return { time: null, value: null };
        }
        const [hours, mins] = timeStr.split(":").map(Number);
        const now = new Date();
        const target = new Date(now.getTime() + dayoffset * 24 * 3600000);
        target.setHours(hours, mins, 0, 0);

        // Find closest prediction point
        let closest = gymLine.interpLine[0];
        let minDiff = Infinity;
        for (const p of gymLine.interpLine) {
            const ptTime = new Date(p.created_at);
            const diff = Math.abs(ptTime.getTime() - target.getTime());
            if (diff < minDiff) { minDiff = diff; closest = p; }
        }
        return { time: target, value: closest?.auslastung || null };
    };

    const reloadData = () => {
        setIsLoading(true);
        const prom = Promise.all([api.getGym(dayoffset), api.getGymInterpLine(dayoffset)]);
        prom.then((res) => {
            setGym(res[0]);
            setGymLine(res[1]);
            setError(undefined);
        })
            .catch((err) => {
                setGym(undefined);
                setGymLine(undefined);
                setError(err + "");
            })
            .then(() => {
                setIsLoading(false);
            });
    };

    useEffect(() => {
        reloadData();

        const tim = setInterval(
            () => {
                reloadData();
            },
            1000 * 60 * 4,
        ); // 4 minutes

        return () => {
            clearInterval(tim);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, dayoffset]);

    return (
        <>
            {error && <div className="alert alert-danger">{error}</div>}
            {gym && gymLine && <LiveStatusCard gym={gym} gymLine={gymLine} />}
            <div style={{ height: "500px" }}>
                {gym && gymLine && <ChartImpl gym={gym} gymLine={gymLine} />}
            </div>

            {hideHandles === false && (
                <div className="d-flex mt-3 ">
                    <button
                        className="btn btn-primary me-2"
                        onClick={reloadData}
                        disabled={isLoading}
                    >
                        Reload
                    </button>
                    <div className="btn-group" role="group">
                        {days.map((d, index) => (
                            <button
                                key={index}
                                type="button"
                                className={`btn btn-outline-secondary ${
                                    dayoffset === index ? "active" : ""
                                }`}
                                onClick={() => setDayoffset(index)}
                            >
                                {d}
                            </button>
                        ))}
                    </div>
                    {isLoading && <div className="spinner-border"></div>}
                </div>
            )}
        </>
    );
}

function CopyStation({ str }: { str: string }) {
    const inputRef = React.createRef<HTMLInputElement>();

    const copy = () => {
        inputRef.current?.select();
        try {
            navigator.clipboard.writeText(str);
        } catch (err) {
            console.error("Failed to copy to clipboard", err);
            document.execCommand("copy");
        }
    };

    return (
        <div className="input-group my-2">
            <input
                type="text"
                className="form-control"
                value={str}
                onClick={copy}
                ref={inputRef}
                readOnly
            />
            <button className="btn btn-outline-secondary" type="button" onClick={copy}>
                Copy
            </button>
        </div>
    );
}

function GymStuff() {
    const [embedCode, setEmbedCode] = useState<string>(EMBED_CODE("https://rwtf.dorianko.ch"));
    const [picUrl, setPicUrl] = useState<string>("https://rwtf.dorianko.ch/embed_picture.png");

    useEffect(() => {
        setEmbedCode(EMBED_CODE(window.location.origin));
        setPicUrl(`${window.location.origin}/embed_picture.png`);
    }, []);

    return (
        <div className="card mt-3">
            <div className="card-header">
                RWTH Gym Utilization (
                <a href="https://buchung.hsz.rwth-aachen.de/angebote/aktueller_zeitraum/_Auslastung.html">
                    Data source
                </a>
                ,{" "}
                <a href="https://hochschulsport.rwth-aachen.de/cms/HSZ/Sport/Sportanlagen/Sportzentrum-Koenigshuegel/~jpwb/RWTH-GYM/">
                    Opening hours
                </a>
                )
            </div>
            <div className="card-body">
                <GymPlotWithHandles />
                <div className="mt-2">
                    <hr />
                    <h4>Legend</h4>
                    <small>
                        <dl>
                            <dt>
                                <strong>Utilization</strong>:
                            </dt>
                            <dd>Number of people in the gym as reported by HSZ.</dd>
                            <dt>
                                <strong>Prediction</strong>:
                            </dt>
                            <dd>
                                Prediction of the number of people in the gym for the remainder of the day, based on historical data and the current trend. Prediction for the current day becomes more accurate as the day progresses and more data points are available.
                            </dd>
                            <dt>
                                <strong>Historic Arrival</strong>:
                            </dt>
                            <dd>
                                Flow rate of people arriving at the gym (Unit: people per hour).
                                <br />
                                For example, you will see that there are spikes around whole hours,
                                this is because most people plan to meet up at the gym at "nice"
                                times.
                                <br />
                                This also usually coincides with the end of lectures.
                            </dd>
                            <dt>
                                <strong>x Week(s) ago</strong>:
                            </dt>
                            <dd>Data from x week(s) ago.</dd>
                        </dl>
                    </small>
                    <small>
                        This Website is <a href="https://github.com/dorian-K/rwtf">open-source</a>!
                    </small>
                    <hr />
                    <h4>Embed</h4>
                    <small>
                        Embed this chart in your Moodle dashboard with the following code:
                        <CopyStation str={embedCode} />
                    </small>
                    <small>
                        Want to write a bot? A screenshot of the graph is made every few minutes and
                        published here:
                        <CopyStation str={picUrl} />
                    </small>
                </div>
            </div>
        </div>
    );
}

function StudyStuff() {
    const api = useBackendContext();
    const [aachener, setIsAachener] = useState<boolean>();

    useEffect(() => {
        api.isAachener().then(setIsAachener);
    }, [api]);

    if (aachener === undefined) {
        return (
            <div className="container">
                <div className="spinner-border"></div>
            </div>
        );
    }
    if (aachener === false) {
        return <>Access more from within the RWTH network!</>;
    }

    const onSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const url = (e.currentTarget.querySelector("#studyUrl") as HTMLInputElement).value;
        window.open(api.getStudyUrl(url), "_blank");
    };

    return (
        <div className="card mt-3">
            <div className="card-header">Study stuff</div>
            <div className="card-body">
                <form onSubmit={onSubmit}>
                    <div className="mb-3">
                        <label htmlFor="studyUrl" className="form-label">
                            Studydrive URL
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            id="studyUrl"
                            placeholder="https://www.studydrive.net/document/1234"
                        />
                    </div>
                    <button type="submit" className="btn btn-primary">
                        Download
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function Home() {
    return (
        <div className="container">
            <GymStuff />
            <StudyStuff />
        </div>
    );
}
