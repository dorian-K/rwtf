import {
    GymInterpLineResponse,
    GymResponse,
    PredictionMethod,
    StudyFileResult,
    StudyInspectResponse,
} from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EMBED_CODE } from "./embed_gym";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

function ChartImpl({ gym, gymLine }: { gym: GymResponse; gymLine: GymInterpLineResponse }) {
    const methodName = gymLine.method
        ? {
              closest: "Similar Weeks",
              average: "Simple Average",
              median: "Robust Average",
              dayofweek: "Same Weekday",
          }[gymLine.method] || "Prediction"
        : "Prediction";
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
        stroke: {
            curve: "smooth",
            width: [3, 2, 2].concat(new Array(historicData.length).fill(1)),
            dashArray: [0, 1, 1].concat(new Array(historicData.length).fill(3)),
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
            name: methodName,
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

    const days = ["Today", "Tomorrow", "+2 days", "+3 days"];
    const [dayoffset, setDayoffset] = useState(0);
    const methods: {
        value: PredictionMethod;
        label: string;
        shortDesc: string;
        fullDesc: string;
    }[] = [
        {
            value: "closest",
            label: "Similar Weeks ⭐",
            shortDesc: "Finds weeks with similar patterns",
            fullDesc:
                "Finds historical weeks with a similar crowd pattern to today and averages them. Captures both the day-of-week effect AND unusual events (e.g., holidays). Most accurate when past weeks had clear, consistent patterns.",
        },
        {
            value: "average",
            label: "Simple Average",
            shortDesc: "Weighted average of all past weeks",
            fullDesc:
                "A weighted average of all historical weeks. Recent weeks count 3x more than older ones. Smooths out noise but can be skewed by unusually crowded or empty weeks.",
        },
        {
            value: "median",
            label: "Robust Average",
            shortDesc: "Median-based, ignores outliers",
            fullDesc:
                "Like Simple Average but uses median instead of mean. Extreme values (packed or empty weeks) have less influence. More stable when data contains unusual weeks.",
        },
        {
            value: "dayofweek",
            label: "Same Weekday",
            shortDesc: "Only uses data from the same day of week",
            fullDesc:
                "Only looks at data from the same day of week (e.g., all Mondays). Best for capturing the regular weekly rhythm. Ignores longer-term trends and anomalies.",
        },
    ];
    const [method, setMethod] = useState<PredictionMethod>("closest");
    const api = useBackendContext();

    const reloadData = () => {
        setIsLoading(true);
        const prom = Promise.all([api.getGym(dayoffset), api.getGymInterpLine(dayoffset, method)]);
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
    }, [api, dayoffset, method]);

    return (
        <>
            {error && <div className="alert alert-danger">{error}</div>}
            <div style={{ height: "500px" }}>
                {gym && gymLine && <ChartImpl gym={gym} gymLine={gymLine} />}
            </div>

            {hideHandles === false && (
                <div className="d-flex mt-3 flex-wrap gap-2">
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
                    <div className="input-group" style={{ maxWidth: "400px" }}>
                        <label className="input-group-text" htmlFor="methodSelect">
                            Prediction:
                        </label>
                        <select
                            className="form-select"
                            id="methodSelect"
                            value={method}
                            onChange={(e) => setMethod(e.target.value as PredictionMethod)}
                            title={methods.find((m) => m.value === method)?.fullDesc}
                        >
                            {methods.map((m) => (
                                <option key={m.value} value={m.value} title={m.fullDesc}>
                                    {m.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    {method === "closest" && (
                        <small className="text-muted ms-2 mt-1">
                            <span className="badge bg-success me-1">Recommended</span>
                            Best overall accuracy for regular gym usage.
                        </small>
                    )}
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

    const [startDate, setStartDate] = useState<string>(formatDate(getLastDays(7)));
    const [endDate, setEndDate] = useState<string>(formatDate(today));
    const [format, setFormat] = useState<"csv" | "json">("csv");
    const [error, setError] = useState<string | null>(null);

    const setPresetRange = (preset: "lastYear" | "allData") => {
        const end = new Date();
        if (preset === "lastYear") {
            const start = new Date(end);
            start.setFullYear(start.getFullYear() - 1);
            setStartDate(formatDate(start));
            setEndDate(formatDate(end));
        } else if (preset === "allData") {
            // Use a date far in the past to capture all available data
            setStartDate("2020-01-01");
            setEndDate(formatDate(end));
        }
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

        const url = `/api/v1/gym/export?start_date=${startDate}&end_date=${endDate}&format=${format}`;
        window.open(url, "_blank");
    };

    return (
        <div className="mt-2">
            <div className="btn-group btn-group-sm mb-2" role="group">
                <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setPresetRange("lastYear")}
                >
                    Last year
                </button>
                <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setPresetRange("allData")}
                >
                    All data
                </button>
            </div>
            <div className="row g-2 align-items-end">
                <div className="col-auto">
                    <label className="form-label small mb-1">Start Date</label>
                    <input
                        type="date"
                        className="form-control form-control-sm"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <div className="col-auto">
                    <label className="form-label small mb-1">End Date</label>
                    <input
                        type="date"
                        className="form-control form-control-sm"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                <div className="col-auto">
                    <label className="form-label small mb-1">Format</label>
                    <select
                        className="form-select form-select-sm"
                        value={format}
                        onChange={(e) => setFormat(e.target.value as "csv" | "json")}
                    >
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                    </select>
                </div>
                <div className="col-auto">
                    <button className="btn btn-sm btn-primary" onClick={handleExport}>
                        Download
                    </button>
                </div>
            </div>
            {error && <div className="text-warning small mt-1">{error}</div>}
        </div>
    );
}

function GymStuff() {
    const api = useBackendContext();
    const [embedCode, setEmbedCode] = useState<string>(EMBED_CODE("https://rwtf.dorianko.ch"));
    const [picUrl, setPicUrl] = useState<string>("https://rwtf.dorianko.ch/embed_picture.png");
    const [isAachen, setIsAachen] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        api.isAachener().then(setIsAachen);
    }, [api]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
                                more data points are available.
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
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("de-DE");
}

function StudyInspect({
    data,
    onDownload,
    onClose,
}: {
    data: StudyInspectResponse;
    onDownload: (url: string) => void;
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
            <div className="modal fade show d-block" tabIndex={-1} role="dialog" onClick={onClose}>
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
                            {!metadata && (
                                <div className="alert alert-secondary py-2">
                                    No extended metadata stored for this file.
                                </div>
                            )}
                            <dl className="row mb-0">
                                {rows.map((r, i) => (
                                    <React.Fragment key={i}>
                                        <dt className="col-sm-4 text-muted">{r.label}</dt>
                                        <dd className="col-sm-8 text-break">{r.value}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-primary"
                                onClick={() => onDownload(file.downloadUrl)}
                            >
                                Download
                            </button>
                            <button className="btn btn-secondary" onClick={onClose}>
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
    useEffect(() => {
        if (!aachener) return;
        const tim = setTimeout(() => runSearch(1), 300);
        return () => clearTimeout(tim);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, aachener, q, sort]);

    const onDownload = (url: string) => {
        window.open(api.getStudyUrl(url), "_blank");
    };

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
                                                        className="btn btn-outline-primary"
                                                        onClick={() => onDownload(r.downloadUrl)}
                                                    >
                                                        Download
                                                    </button>
                                                    <button
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
                                className="btn btn-outline-secondary"
                                disabled={page === 1 || loading}
                                onClick={() => runSearch(page - 1)}
                            >
                                ← Prev
                            </button>
                            <button
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
                    onDownload={onDownload}
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
        </div>
    );
}
