import type React from "react";
import { useEffect, useState, Suspense, lazy } from "react";
import Link from "next/link";
import { useBackendContext } from "@/components/BackendProvider";
import { useChartColors } from "@/components/DesignProvider";
import type { ApexOptions } from "apexcharts";
import type { StatsResponse, ViewersResponse } from "@/api/Backend";

const ReactApexChart = lazy(() =>
    import("react-apexcharts").then((m) => ({
        default: m.default as unknown as React.ComponentType<any>,
    })),
);

// Local calendar day as YYYY-MM-DD, matching the server's day boundaries (both Europe/Berlin).
function localDay(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDay(day: string, by: number): string {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + by);
    return localDay(d);
}

function DailyChart({ daily }: { daily: StatsResponse["daily"] }) {
    const colors = useChartColors();
    const options: ApexOptions = {
        chart: { type: "bar", height: 300, foreColor: colors.text, toolbar: { show: false } },
        dataLabels: { enabled: false },
        xaxis: { type: "datetime", labels: { datetimeUTC: false } },
        yaxis: { min: 0, decimalsInFloat: 0, title: { text: "Unique visitors" } },
        plotOptions: { bar: { borderRadius: 2 } },
        theme: { mode: "dark" },
        tooltip: { x: { format: "ddd, dd MMM yyyy" } },
    };
    const series = [
        {
            name: "Visitors",
            data: daily.map((d) => ({ x: new Date(`${d.day}T00:00:00`).getTime(), y: d.uniques })),
        },
    ];
    return (
        <Suspense fallback={<div className="text-center text-muted py-4">Loading chart...</div>}>
            <ReactApexChart type="bar" options={options} series={series} height={300} />
        </Suspense>
    );
}

function ViewersChart({ windows }: { windows: ViewersResponse["windows"] }) {
    const colors = useChartColors();
    const options: ApexOptions = {
        chart: {
            type: "area",
            height: 300,
            stacked: true,
            foreColor: colors.text,
            toolbar: { show: true },
            zoom: { enabled: true },
        },
        dataLabels: { enabled: false },
        stroke: { curve: "stepline", width: 2 },
        xaxis: { type: "datetime", labels: { datetimeUTC: false } },
        yaxis: { min: 0, decimalsInFloat: 0, title: { text: "People with the site open" } },
        theme: { mode: "dark" },
        tooltip: { x: { format: "HH:mm" } },
        legend: { labels: { colors: colors.text } },
    };
    const series = (["dashboard", "embed"] as const).map((k) => ({
        name: k === "dashboard" ? "Website" : "Embedded widget",
        data: windows.map((w) => ({ x: new Date(w.t).getTime(), y: w[k] })),
    }));
    return (
        <Suspense fallback={<div className="text-center text-muted py-4">Loading chart...</div>}>
            <ReactApexChart type="area" options={options} series={series} height={300} />
        </Suspense>
    );
}

export default function StatsPage() {
    const api = useBackendContext();
    const [stats, setStats] = useState<StatsResponse>();
    const [viewers, setViewers] = useState<ViewersResponse>();
    // Set client-side: the static export is prerendered without the visitor's clock.
    const [day, setDay] = useState<string>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        setDay(localDay(new Date()));
        api.getStats()
            .then(setStats)
            .catch((e) => setError(String(e)));
    }, [api]);

    useEffect(() => {
        if (!day) return;
        api.getViewers(day)
            .then(setViewers)
            .catch((e) => setError(String(e)));
    }, [api, day]);

    const today = stats?.daily.find((d) => d.day === day)?.uniques ?? 0;
    const last30 = stats?.daily.slice(-31, -1) ?? []; // complete days before today
    const avg30 = last30.length ? last30.reduce((a, d) => a + d.uniques, 0) / last30.length : 0;
    const isToday = day === localDay(new Date());

    return (
        <div className="container mt-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="text-white mb-0">Usage Statistics</h1>
                <small className="text-muted">Anonymous counts, no cookies</small>
            </div>

            <div className="mb-4">
                <Link href="/" className="btn btn-outline-secondary">
                    &larr; Back to Live View
                </Link>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            {stats && (
                <div className="card bg-dark shadow-lg mb-4">
                    <div className="card-body">
                        <div className="row text-center">
                            <div className="col-md-4">
                                <h6 className="text-muted">Last 7 days</h6>
                                <h3>{stats.visits7d.toLocaleString("en-US")}</h3>
                                <small className="text-muted">visits</small>
                            </div>
                            <div className="col-md-4">
                                <h6 className="text-muted">Today</h6>
                                <h3>{today.toLocaleString("en-US")}</h3>
                                <small className="text-muted">visitors so far</small>
                            </div>
                            <div className="col-md-4">
                                <h6 className="text-muted">Daily average</h6>
                                <h3>{Math.round(avg30).toLocaleString("en-US")}</h3>
                                <small className="text-muted">visitors, last 30 days</small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {stats && (
                <div className="card bg-dark shadow-lg mb-4">
                    <div className="card-header">
                        <h5 className="mb-0">Visitors per Day</h5>
                    </div>
                    <div className="card-body">
                        <DailyChart daily={stats.daily} />
                    </div>
                </div>
            )}

            {day && (
                <div className="card bg-dark shadow-lg mb-4">
                    <div className="card-header d-flex flex-wrap gap-2 align-items-center">
                        <h5 className="mb-0 me-auto">Over the Day (5-minute steps)</h5>
                        <div className="btn-group btn-group-sm">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() => setDay(shiftDay(day, -1))}
                            >
                                &larr;
                            </button>
                            <input
                                type="date"
                                className="form-control form-control-sm"
                                aria-label="Day"
                                value={day}
                                max={localDay(new Date())}
                                onChange={(e) => e.target.value && setDay(e.target.value)}
                            />
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                disabled={isToday}
                                onClick={() => setDay(shiftDay(day, 1))}
                            >
                                &rarr;
                            </button>
                        </div>
                    </div>
                    <div className="card-body">
                        {viewers && viewers.windows.length > 0 ? (
                            <ViewersChart windows={viewers.windows} />
                        ) : (
                            <div className="text-muted">No data for this day.</div>
                        )}
                    </div>
                </div>
            )}

            <p className="small text-muted">
                A visit is one browser on one day: the server recognizes repeat requests within a
                day by a salted hash that is deleted at midnight, and stores only the counts. A
                person who comes back on several days counts once per day. Bots are not counted.
            </p>
        </div>
    );
}
