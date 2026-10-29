import {
    type GymInterpLineResponse,
    type GymPredictionMethod,
    type GymResponse,
    StudyDownloadError,
    type StudyFileResult,
    type StudyInspectResponse,
} from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import type { ApexOptions } from "apexcharts";
import React from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EMBED_CODE } from "./embed_gym";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

// ApexCharts' default palette tail, used for the (hidden-by-default) "x weeks ago" series. We set
// colors explicitly so inserting the confidence-band series doesn't reshuffle the other series'
// colors: Utilization stays blue, the band + prediction line share green.
const GYM_HISTORIC_COLORS = [
    "#FF4560",
    "#775DD0",
    "#3F51B5",
    "#546E7A",
    "#D4526E",
    "#8D5B4C",
    "#F86624",
    "#D7263D",
    "#1B998B",
    "#2E294E",
    "#F46036",
    "#E2C044",
];

// Timestral is the default: on the full backtest it beat Similar Weeks (MAE 9.7 vs 12.1) with
// tighter, still well-calibrated bands. Similar Weeks stays as the choice and the fallback.
const METHOD_NAMES: Record<GymPredictionMethod, string> = {
    timestral: "Timestral",
    closest: "Similar Weeks",
};
const DEFAULT_METHOD: GymPredictionMethod = "timestral";
const METHOD_STORAGE_KEY = "gymPredictionMethod";

function ChartImpl({
    gym,
    gymLine,
    method,
}: {
    gym: GymResponse;
    gymLine: GymInterpLineResponse;
    method: GymPredictionMethod;
}) {
    const methodName = METHOD_NAMES[method];
    let todayReference: Date;
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

    const adjustDate = (d: Date | string) => {
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

    // A forecast that starts after the latest sample (Timestral's starts one 5-min step later) would
    // leave a visible jump from the actual curve. If the gap is at most one step, anchor the line
    // and both bands at the current value so the prediction continues from it.
    let predLine = gymLine.interpLine;
    const lastActual = data[data.length - 1];
    // Show the prediction only where there is no actual data yet: Similar Weeks spans the whole day,
    // and a Timestral forecast made from an older sample starts inside the actual curve.
    if (lastActual) {
        predLine = predLine.filter(
            (p) => adjustDate(new Date(p.created_at)) > lastActual.created_at,
        );
    }
    if (lastActual && predLine.length > 0) {
        const gap = adjustDate(new Date(predLine[0].created_at)) - lastActual.created_at;
        if (gap > 0 && gap <= 5 * 60 * 1000) {
            const v = lastActual.auslastung;
            const anchor = { auslastung: v, lower: v, upper: v, lowerWide: v, upperWide: v };
            const created_at = new Date(lastActual.created_at).toISOString();
            predLine = [{ ...anchor, created_at }, ...predLine];
        }
    }

    const data_historic = gym.data_historic || [];
    const historicData = data_historic.map((week) =>
        week
            .map((g) => ({
                ...g,
                created_at: adjustDate(g.created_at),
            }))
            .sort((a, b) => a.created_at - b.created_at),
    );

    const minX = new Date(todayReference).setHours(6, 0, 0, 0);
    const maxX = new Date(todayReference).setHours(23, 59, 59, 999);
    const currentTimestamp = new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date());

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
        colors: ["#008FFB", "#00E396", "#00E396", "#00E396", "#FEB019"].concat(
            historicData.map((_, i) => GYM_HISTORIC_COLORS[i % GYM_HISTORIC_COLORS.length]),
        ),
        stroke: {
            curve: "smooth",
            // Series order: Utilization, 100% band, 50% band (both borderless), Prediction, Arrival.
            width: [3, 0, 0, 3, 2].concat(new Array(historicData.length).fill(1)),
            dashArray: [0, 0, 0, 0, 1].concat(new Array(historicData.length).fill(3)),
        },
        title: {
            text: `RWTH Gym Utilization · ${currentTimestamp}`,
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
            borderColor: "#5a5249",
            xaxis: {
                lines: {
                    show: true,
                },
            },
        },
        fill: {
            type: "solid",
            opacity: [0.4, 0.12, 0.22, 0.15, 0.15].concat(
                new Array(historicData.length).fill(0.02),
            ),
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

    const historicArrivals = [];
    for (let i = 0; i < gymLine.interpLine.length; i++) {
        const g = gymLine.interpLine[i];
        let val = g.auslastung;
        let j = i - 1;
        const minTime = adjustDate(new Date(g.created_at)) - 1000 * 60 * 60 * 1.5; // 1.5 hrs
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
    const smoothedArrivals = [];
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

    // Interpolate today's actual utilization at an arbitrary time (ms), or null outside its range.
    // Used to keep the 100% band from ever excluding what actually happened.
    const actualAt = (t: number): number | null => {
        if (data.length === 0 || t < data[0].created_at || t > data[data.length - 1].created_at) {
            return null;
        }
        for (let i = 1; i < data.length; i++) {
            if (data[i].created_at >= t) {
                const a = data[i - 1];
                const b = data[i];
                const span = b.created_at - a.created_at || 1;
                return a.auslastung + ((t - a.created_at) / span) * (b.auslastung - a.auslastung);
            }
        }
        return data[data.length - 1].auslastung;
    };

    let series: ApexOptions["series"] = [
        {
            name: "Utilization",
            zIndex: 1,
            data: data.map((g) => ({
                x: g.created_at,
                // Absolute number of people currently in the gym, not a percentage value.
                y: g.auslastung,
            })),
        },
        {
            // Outer band: min–max of the most similar historical days, widened where needed so it
            // always contains today's actual utilization. Backtesting puts its real forecast
            // coverage at ~90% (min/max of a ~15-day pool covers ≈(n−1)/(n+1)), hence the label.
            name: "~90% range",
            type: "rangeArea",
            data: predLine.map((g) => {
                const x = adjustDate(new Date(g.created_at));
                let lo = g.lowerWide ?? g.auslastung;
                let hi = g.upperWide ?? g.auslastung;
                const act = actualAt(x);
                if (act !== null) {
                    lo = Math.min(lo, act);
                    hi = Math.max(hi, act);
                }
                return { x, y: [lo, hi] };
            }),
        },
        {
            // Tight middle-50% (inter-quartile) band.
            name: "50% range",
            type: "rangeArea",
            data: predLine.map((g) => ({
                x: adjustDate(new Date(g.created_at)),
                y: [g.lower ?? g.auslastung, g.upper ?? g.auslastung],
            })),
        },
        {
            name: methodName,
            type: "line",
            zIndex: 5,
            data: predLine.map((g) => {
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

// "Today", "Tomorrow", then weekday names for the remaining day tabs.
function dayLabels(): string[] {
    return [0, 1, 2, 3].map((offset) => {
        if (offset === 0) return "Today";
        if (offset === 1) return "Tomorrow";
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString("en-US", { weekday: "long" });
    });
}

export function GymPlotWithHandles({ hideHandles = false }: { hideHandles?: boolean }) {
    const [gym, setGym] = useState<GymResponse>();
    const [gymLine, setGymLine] = useState<GymInterpLineResponse>();
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);

    // Weekday names depend on the visitor's clock, so the static export ships placeholders and
    // reloadData fills in the real names (keeping them right across midnight).
    const [days, setDays] = useState(["Today", "Tomorrow", "+2 days", "+3 days"]);
    const [dayoffset, setDayoffset] = useState(0);
    // The method the shown gymLine was fetched with, so the legend never mislabels a stale line.
    const [method, setMethod] = useState<GymPredictionMethod>(DEFAULT_METHOD);
    const [lineMethod, setLineMethod] = useState<GymPredictionMethod>(DEFAULT_METHOD);
    // The method that line was requested with; differs from lineMethod after a fallback.
    const [lineRequested, setLineRequested] = useState<GymPredictionMethod>(DEFAULT_METHOD);
    // Set when the requested method failed and the chart fell back to Similar Weeks.
    const [notice, setNotice] = useState<string>();
    // Only the latest request may update the chart; an older, slower one (e.g. the default method's,
    // superseded by the visitor's saved choice) must not overwrite it.
    const requestSeq = useRef(0);
    const api = useBackendContext();

    // Restore the visitor's last choice (static export: localStorage is only available client-side).
    useEffect(() => {
        try {
            const saved = localStorage.getItem(METHOD_STORAGE_KEY);
            if (saved === "closest" || saved === "timestral") setMethod(saved);
        } catch {
            // storage blocked (private mode, embeds): keep the default
        }
    }, []);

    const chooseMethod = (m: GymPredictionMethod) => {
        // Re-picking the current method (e.g. Timestral after a fallback) retries it.
        if (m === method) reloadData();
        setMethod(m);
        try {
            localStorage.setItem(METHOD_STORAGE_KEY, m);
        } catch {
            // not persisted; the choice still applies for this visit
        }
    };

    const reloadData = () => {
        setDays(dayLabels());
        setIsLoading(true);
        const seq = ++requestSeq.current;
        const requested = method;
        // The Timestral model runs in a separate service that may be down; fall back to Similar
        // Weeks rather than leaving the chart empty.
        const line =
            requested === "timestral"
                ? api
                      .getGymInterpLine(dayoffset, "timestral")
                      .then((l) => ({ line: l, used: requested }))
                      .catch(() =>
                          api
                              .getGymInterpLine(dayoffset, "closest")
                              .then((l) => ({ line: l, used: "closest" as GymPredictionMethod })),
                      )
                : api
                      .getGymInterpLine(dayoffset, requested)
                      .then((l) => ({ line: l, used: requested }));
        const prom = Promise.all([api.getGym(dayoffset), line]);
        prom.then(([g, l]) => {
            if (seq !== requestSeq.current) return;
            setGym(g);
            setGymLine(l.line);
            setLineMethod(l.used);
            setLineRequested(requested);
            setNotice(
                l.used !== requested
                    ? "The Timestral forecast is unavailable right now, showing Similar Weeks instead."
                    : undefined,
            );
            setError(undefined);
        })
            .catch((err) => {
                if (seq !== requestSeq.current) return;
                setGym(undefined);
                setGymLine(undefined);
                setNotice(undefined);
                setError(err + "");
            })
            .then(() => {
                if (seq === requestSeq.current) setIsLoading(false);
            });
    };

    // The selector shows the method actually on the chart (so a fallback is visible there too),
    // except right after the visitor picks another one and its line is still loading.
    const activeMethod = method === lineRequested ? lineMethod : method;

    // biome-ignore lint/correctness/useExhaustiveDependencies: rerun on the listed inputs only
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
    }, [api, dayoffset, method]);

    return (
        <>
            {error && <div className="alert alert-danger">{error}</div>}
            {notice && !hideHandles && (
                <div className="alert alert-warning py-1 small">{notice}</div>
            )}
            <div style={{ height: "500px" }}>
                {gym && gymLine && <ChartImpl gym={gym} gymLine={gymLine} method={lineMethod} />}
            </div>

            {hideHandles === false && (
                <div className="d-flex mt-3 flex-wrap gap-2">
                    <button
                        type="button"
                        className="btn btn-primary me-2"
                        onClick={reloadData}
                        disabled={isLoading}
                    >
                        Reload
                    </button>
                    <div className="btn-group" role="group">
                        {days.map((d, index) => (
                            <button
                                key={d}
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
                    <div className="btn-group" role="group" aria-label="Prediction method">
                        {(Object.keys(METHOD_NAMES) as GymPredictionMethod[]).map((m) => (
                            <button
                                key={m}
                                type="button"
                                className={`btn btn-outline-secondary ${
                                    activeMethod === m ? "active" : ""
                                }`}
                                onClick={() => chooseMethod(m)}
                                title={
                                    m === "timestral"
                                        ? "Forecast by Mistral's Timestral-209M time-series model"
                                        : "Average of the most similar past days"
                                }
                            >
                                {METHOD_NAMES[m]}
                            </button>
                        ))}
                    </div>
                    <a
                        className="small align-self-center"
                        href="https://mistral.ai/news/timestral/"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Timestral is Mistral's open time-series forecasting model. It predicts the curve directly from the recent gym history, instead of averaging similar past days."
                    >
                        What is Timestral?
                    </a>
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

function DataExportForm() {
    const today = new Date();
    const formatDate = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    // Parse YYYY-MM-DD as local midnight (avoids JS treating it as UTC)
    const parseLocalDate = (str: string): Date => {
        const [year, month, day] = str.split("-").map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    };

    const getLastDays = (days: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - days);
        return d;
    };

    // The backend only exports the last 6 months (EXPORT_MAX_AGE_MONTHS in server/src/index.ts).
    const earliest = new Date(today);
    earliest.setMonth(earliest.getMonth() - 6);
    const earliestStr = formatDate(earliest);

    const [startDate, setStartDate] = useState<string>(formatDate(getLastDays(7)));
    const [endDate, setEndDate] = useState<string>(formatDate(today));
    const [format, setFormat] = useState<"csv" | "json">("csv");
    const [error, setError] = useState<string | null>(null);

    // Both presets fit the backend's 31-day-per-request limit.
    const setPresetRange = (days: number) => {
        setStartDate(formatDate(getLastDays(days - 1)));
        setEndDate(formatDate(today));
    };

    const handleExport = () => {
        setError(null);
        const start = parseLocalDate(startDate);
        const end = parseLocalDate(endDate);
        const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // Backend limit: 31 days
        if (diffDays > 31) {
            setError(`Date range cannot exceed 31 days. Contact dorian.koch${"@"}rwth-aachen.de`);
            return;
        }
        if (diffDays < 0) {
            setError("End date must be after start date");
            return;
        }
        if (startDate < earliestStr) {
            setError(
                `Only the last 6 months can be exported (from ${earliestStr}). ` +
                    `For older data, email dorian.koch${"@"}rwth-aachen.de`,
            );
            return;
        }

        const url = `/api/v1/gym/export?start_date=${startDate}&end_date=${endDate}&format=${format}`;
        window.open(url, "_blank");
    };

    return (
        <div className="mt-2">
            <div className="btn-group btn-group-sm mb-2" role="group">
                <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setPresetRange(7)}
                >
                    Last 7 days
                </button>
                <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setPresetRange(31)}
                >
                    Last 31 days
                </button>
            </div>
            <div className="row g-2 align-items-end">
                <div className="col-auto">
                    <label className="form-label small mb-1" htmlFor="export-start">
                        Start Date
                    </label>
                    <input
                        id="export-start"
                        type="date"
                        className="form-control form-control-sm"
                        value={startDate}
                        min={earliestStr}
                        max={formatDate(today)}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <div className="col-auto">
                    <label className="form-label small mb-1" htmlFor="export-end">
                        End Date
                    </label>
                    <input
                        id="export-end"
                        type="date"
                        className="form-control form-control-sm"
                        value={endDate}
                        min={earliestStr}
                        max={formatDate(today)}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                <div className="col-auto">
                    <label className="form-label small mb-1" htmlFor="export-format">
                        Format
                    </label>
                    <select
                        id="export-format"
                        className="form-select form-select-sm"
                        value={format}
                        onChange={(e) => setFormat(e.target.value as "csv" | "json")}
                    >
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                    </select>
                </div>
                <div className="col-auto">
                    <button type="button" className="btn btn-sm btn-primary" onClick={handleExport}>
                        Download
                    </button>
                </div>
            </div>
            {error && <div className="text-warning small mt-1">{error}</div>}
        </div>
    );
}

// Visit counting started in late October 2026; before November the 7-day sum would undercount.
const SHOW_VISITS_FROM = new Date("2026-11-01T00:00:00");

function GymStuff() {
    const api = useBackendContext();
    const [embedCode, setEmbedCode] = useState<string>(EMBED_CODE("https://rwtf.dorianko.ch"));
    const [picUrl, setPicUrl] = useState<string>("https://rwtf.dorianko.ch/embed_picture.png");
    const [isAachen, setIsAachen] = useState<boolean | undefined>(undefined);
    const [visits7d, setVisits7d] = useState<number>();

    useEffect(() => {
        api.isAachener().then(setIsAachen);
        if (Date.now() < SHOW_VISITS_FROM.getTime()) return;
        api.getStats()
            .then((s) => setVisits7d(s.visits7d))
            .catch(() => {}); // the counter is decoration; hide it if stats are unavailable
    }, [api]);

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
                {visits7d !== undefined && (
                    <span className="float-end small text-muted">
                        {visits7d.toLocaleString("en-US")} visits in the last 7 days
                    </span>
                )}
            </div>
            <div className="card-body">
                <GymPlotWithHandles />
                <div className="mt-2">
                    <hr />
                    <div className="mb-3 d-flex flex-wrap gap-2">
                        <Link href="/trends" className="btn btn-primary">
                            View Historical Trends
                        </Link>
                        <Link
                            href="/wifi"
                            className={"btn btn-primary " + (isAachen ? "" : "disabled")}
                        >
                            WiFi Usage by Building
                        </Link>
                    </div>
                    <h4>Legend</h4>
                    <small>
                        <dl>
                            <dt>
                                <strong>Utilization</strong>:
                            </dt>
                            <dd>
                                Absolute number of people in the gym as reported by HSZ, not a
                                percentage.
                            </dd>
                            <dt>
                                <strong>Prediction</strong>:
                            </dt>
                            <dd>
                                Prediction of the number of people in the gym for the remainder of
                                the day, based on historical data and the current trend. Prediction
                                for the current day becomes more accurate as the day progresses and
                                more data points are available. The two shaded bands show the middle
                                50% and roughly the 90% range of the most similar past days.
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
                        {" · "}
                        <Link href="/stats">Usage stats</Link>
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
                    <hr />
                    <h4>Export Data</h4>
                    <small>
                        Download gym utilization data for your own analysis.
                        <DataExportForm />
                        <span className="text-muted small">
                            Max 31 days per export. Last 5 exports limited per hour.
                        </span>
                    </small>
                </div>
            </div>
        </div>
    );
}

// Per-error-code guidance. The backend's `msg` says what went wrong; this says what the user can do
// about it, which the raw message can't (it doesn't know it's being read by a person on a webpage).
const STUDY_ERROR_HINTS: { [code: string]: string } = {
    unknown_type:
        "StudyDrive doesn't tell us the file type for this document. You can still download it " +
        "directly from StudyDrive.",
    upstream:
        "StudyDrive didn't hand over this document — it may have been deleted or made private.",
    invalid_url: "Paste the full document link, e.g. https://www.studydrive.net/document/1234567.",
    not_aachen: "Downloads only work from inside the RWTH network.",
    network: "Check your connection and try again.",
    internal: "This one is on us — try again in a moment.",
};

function StudyDownloadAlert({
    error,
    onDismiss,
}: {
    error: StudyDownloadError;
    onDismiss: () => void;
}) {
    const hint = STUDY_ERROR_HINTS[error.code];
    return (
        <div className="alert alert-warning alert-dismissible d-flex gap-2 align-items-start">
            <div>
                <strong>Download failed.</strong> {error.message}
                {hint && <div className="small mt-1">{hint}</div>}
            </div>
            <button type="button" className="btn-close" aria-label="Dismiss" onClick={onDismiss} />
        </div>
    );
}

// Shared download handling for both study cards: tracks which document is in flight (so the button
// can show a spinner) and keeps the failure around to render, instead of letting the browser save
// the error response as a file.
function useStudyDownload() {
    const api = useBackendContext();
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<StudyDownloadError | null>(null);

    const download = (url: string) => {
        setError(null);
        setPending(url);
        api.downloadStudyFile(url)
            .catch((e) => {
                setError(
                    e instanceof StudyDownloadError
                        ? e
                        : new StudyDownloadError("internal", String(e?.message ?? e)),
                );
            })
            .finally(() => setPending(null));
    };

    return { download, pending, error, clearError: () => setError(null) };
}

function StudyStuff() {
    const api = useBackendContext();
    const [aachener, setIsAachener] = useState<boolean>();
    const { download, pending, error, clearError } = useStudyDownload();

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
        const url = (e.currentTarget.querySelector("#studyUrl") as HTMLInputElement).value.trim();
        if (url) download(url);
    };

    return (
        <div className="card mt-3">
            <div className="card-header">Study stuff</div>
            <div className="card-body">
                {error && <StudyDownloadAlert error={error} onDismiss={clearError} />}
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
                    <button type="submit" className="btn btn-primary" disabled={pending !== null}>
                        {pending !== null && (
                            <span className="spinner-border spinner-border-sm me-2"></span>
                        )}
                        {pending !== null ? "Fetching…" : "Download"}
                    </button>
                </form>
            </div>
        </div>
    );
}

// StudyDrive exposes file_type as an integer code; label the ones we know, fall back to the code.
function fileTypeLabel(code: number): string {
    const labels: { [key: number]: string } = {
        1: "Document",
        2: "Summary",
        3: "Exam",
        4: "Notes",
        5: "Assignment",
    };
    return labels[code] ?? `Type ${code}`;
}

// A few StudyDrive metadata keys worth surfacing in the inspect view, if present in the blob.
const INSPECT_META_FIELDS: { key: string; label: string }[] = [
    { key: "description", label: "Description" },
    { key: "number_of_pages", label: "Pages" },
    { key: "language", label: "Language" },
    { key: "avg_star_score", label: "Rating" },
];

// StudyDrive's created_at (upload date) may be a datetime string or a unix timestamp; render best
// effort, falling back to the raw value.
function formatStudyDate(v: string | null | undefined): string {
    if (!v) return "—";
    let d: Date;
    if (/^\d+$/.test(v)) {
        const n = Number(v);
        d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
        d = new Date(v);
    }
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("de-DE");
}

function StudyInspect({
    data,
    onDownload,
    downloading,
    error,
    onDismissError,
    onClose,
}: {
    data: StudyInspectResponse;
    onDownload: (url: string) => void;
    downloading: boolean;
    error: StudyDownloadError | null;
    onDismissError: () => void;
    onClose: () => void;
}) {
    const { file, metadata } = data;
    const rows: { label: string; value: React.ReactNode }[] = [
        { label: "Course", value: file.course_name || "—" },
        { label: "Professor", value: file.professor_name || "—" },
        { label: "University", value: file.university_name || "—" },
        { label: "Semester", value: file.semester_label || "—" },
        { label: "Type", value: metadata?.file_type_label || fileTypeLabel(file.file_type) },
        { label: "Downloads (this site)", value: file.download_count },
        { label: "Uploaded to StudyDrive", value: formatStudyDate(file.uploaded_at) },
    ];
    if (metadata) {
        for (const f of INSPECT_META_FIELDS) {
            const v = metadata[f.key];
            if (v !== undefined && v !== null && v !== "") {
                rows.push({ label: f.label, value: String(v) });
            }
        }
    }

    return (
        <>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; the Close buttons work by keyboard */}
            <div className="modal fade show d-block" tabIndex={-1} role="dialog" onClick={onClose}>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: only keeps clicks off the backdrop */}
                <div
                    className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered"
                    role="document"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="modal-content">
                        <div className="modal-header">
                            <h5 className="modal-title text-break">{file.filename}</h5>
                            <button
                                type="button"
                                className="btn-close"
                                aria-label="Close"
                                onClick={onClose}
                            ></button>
                        </div>
                        <div className="modal-body">
                            {/* Repeated here because the card's own alert sits behind the backdrop. */}
                            {error && (
                                <StudyDownloadAlert error={error} onDismiss={onDismissError} />
                            )}
                            {!metadata && (
                                <div className="alert alert-secondary py-2">
                                    No extended metadata stored for this file.
                                </div>
                            )}
                            <dl className="row mb-0">
                                {rows.map((r) => (
                                    <React.Fragment key={r.label}>
                                        <dt className="col-sm-4 text-muted">{r.label}</dt>
                                        <dd className="col-sm-8 text-break">{r.value}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={downloading}
                                onClick={() => onDownload(file.downloadUrl)}
                            >
                                {downloading && (
                                    <span className="spinner-border spinner-border-sm me-2"></span>
                                )}
                                {downloading ? "Fetching…" : "Download"}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="modal-backdrop fade show"></div>
        </>
    );
}

function StudySearch() {
    const api = useBackendContext();
    const [aachener, setIsAachener] = useState<boolean>();
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("downloads");
    const [page, setPage] = useState(1);
    const [results, setResults] = useState<StudyFileResult[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inspect, setInspect] = useState<StudyInspectResponse | null>(null);
    const {
        download,
        pending,
        error: downloadError,
        clearError: clearDownloadError,
    } = useStudyDownload();

    useEffect(() => {
        api.isAachener().then(setIsAachener);
    }, [api]);

    const runSearch = (targetPage: number) => {
        setLoading(true);
        api.searchStudyFiles({ q, sort, page: targetPage, pageSize: 20 })
            .then((d) => {
                setResults(d.results);
                setHasMore(d.has_more);
                setPage(d.page);
                setError(null);
            })
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    };

    // Debounced search whenever the query or sort changes; always resets to page 1.
    // biome-ignore lint/correctness/useExhaustiveDependencies: rerun on the listed inputs only
    useEffect(() => {
        if (!aachener) return;
        const tim = setTimeout(() => runSearch(1), 300);
        return () => clearTimeout(tim);
    }, [api, aachener, q, sort]);

    if (aachener === undefined || aachener === false) {
        // Access gate is already shown by the StudyStuff card above; render nothing here.
        return null;
    }

    return (
        <>
            <div className="card mt-3">
                <div className="card-header">Browse downloaded files</div>
                <div className="card-body">
                    {error && <div className="alert alert-danger">{error}</div>}
                    {downloadError && (
                        <StudyDownloadAlert error={downloadError} onDismiss={clearDownloadError} />
                    )}
                    <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
                        <div className="input-group" style={{ maxWidth: "420px" }}>
                            <span className="input-group-text">Search</span>
                            <input
                                type="text"
                                className="form-control"
                                placeholder="filename, course, professor, university…"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                            />
                        </div>
                        <div className="input-group" style={{ maxWidth: "220px" }}>
                            <label className="input-group-text" htmlFor="studySort">
                                Sort
                            </label>
                            <select
                                className="form-select"
                                id="studySort"
                                value={sort}
                                onChange={(e) => setSort(e.target.value)}
                            >
                                <option value="downloads">Most downloaded</option>
                                <option value="uploaded">Recently uploaded</option>
                            </select>
                        </div>
                        {loading && <div className="spinner-border spinner-border-sm"></div>}
                    </div>

                    {!loading && results.length === 0 ? (
                        <p className="text-muted mb-0">No files match your search.</p>
                    ) : (
                        <div className="table-responsive">
                            <table className="table table-sm table-hover align-middle">
                                <thead>
                                    <tr>
                                        <th>Filename</th>
                                        <th>Course</th>
                                        <th>Professor</th>
                                        <th>University</th>
                                        <th>Semester</th>
                                        <th>Type</th>
                                        <th className="text-end">Downloads</th>
                                        <th>Uploaded</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r) => (
                                        <tr key={r.id}>
                                            <td>{r.filename}</td>
                                            <td>{r.course_name || "—"}</td>
                                            <td>{r.professor_name || "—"}</td>
                                            <td>{r.university_name || "—"}</td>
                                            <td>{r.semester_label || "—"}</td>
                                            <td>{fileTypeLabel(r.file_type)}</td>
                                            <td className="text-end">{r.download_count}</td>
                                            <td className="text-nowrap">
                                                {formatStudyDate(r.uploaded_at)}
                                            </td>
                                            <td className="text-nowrap">
                                                <div className="btn-group btn-group-sm">
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-primary"
                                                        disabled={pending !== null}
                                                        onClick={() => download(r.downloadUrl)}
                                                    >
                                                        {pending === r.downloadUrl ? (
                                                            <span className="spinner-border spinner-border-sm"></span>
                                                        ) : (
                                                            "Download"
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-secondary"
                                                        onClick={() =>
                                                            api
                                                                .inspectStudyFile(r.study_id)
                                                                .then(setInspect)
                                                                .catch((e) => setError(String(e)))
                                                        }
                                                    >
                                                        Inspect
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="d-flex align-items-center gap-2">
                        <div className="btn-group btn-group-sm" role="group">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                disabled={page === 1 || loading}
                                onClick={() => runSearch(page - 1)}
                            >
                                ← Prev
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                disabled={!hasMore || loading}
                                onClick={() => runSearch(page + 1)}
                            >
                                Next →
                            </button>
                        </div>
                        <span className="text-muted small">Page {page}</span>
                    </div>
                </div>
            </div>

            {inspect && (
                <StudyInspect
                    data={inspect}
                    onDownload={download}
                    downloading={pending !== null}
                    error={downloadError}
                    onDismissError={clearDownloadError}
                    onClose={() => setInspect(null)}
                />
            )}
        </>
    );
}

export default function Home() {
    return (
        <div className="container">
            <GymStuff />
            <StudyStuff />
            <StudySearch />
            <footer className="text-center my-3" style={{ fontSize: "0.7rem" }}>
                <Link href="/privacy" className="text-muted">
                    Privacy
                </Link>
            </footer>
        </div>
    );
}
