import React, { useEffect, useState, Suspense, lazy } from "react";
import Link from "next/link";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import {
    MonthlyDataPoint,
    HourlyDataPoint,
    DayOfWeekDataPoint,
    HeatmapDataPoint,
    HistoryDataPoint,
} from "@/api/Backend";
import { interpolateHsl } from "d3-interpolate";

const ReactApexChart = lazy(() =>
    import("react-apexcharts").then((m) => ({
        default: m.default as unknown as React.ComponentType<any>,
    })),
);

function toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

// Days of week ordered Monday-first (ISO standard)
const DAY_NAMES_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Convert API day_of_week (1=Sun..7=Sat) to Monday-first index (0=Mon..6=Sun)
function dayOfWeekToMonFirst(apiDay: number): number {
    // 1=Sun -> 6, 2=Mon -> 0, 3=Tue -> 1, ..., 7=Sat -> 5
    return apiDay === 1 ? 6 : apiDay - 2;
}

// Convert Monday-first index (0=Mon..6=Sun) to API day_of_week (1=Sun..7=Sat)
function monFirstToDayOfWeek(monFirstIndex: number): number {
    // 0 -> 2 (Mon), 1 -> 3 (Tue), ..., 5 -> 7 (Sat), 6 -> 1 (Sun)
    return monFirstIndex === 6 ? 1 : monFirstIndex + 2;
}

const heatmapColorInterpolator = interpolateHsl("#28a745", "#dc3545");

function getHeatmapColor(value: number, maxValue: number): string {
    if (maxValue <= 0 || value === null || value === undefined || isNaN(value)) {
        return "#000000";
    }

    const normalized = Math.max(0, Math.min(1, value / maxValue));
    return heatmapColorInterpolator(normalized);
}

function WeeklyLineChart({ data }: { data: HistoryDataPoint[] }) {
    const options: ApexOptions = {
        chart: {
            type: "area",
            height: 300,
            foreColor: "#ffffff",
            toolbar: { show: true },
            zoom: { enabled: true },
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: data.map((d) => d.time_bucket),
            labels: {
                rotate: -45,
                rotateAlways: true,
            },
            type: "category",
        },
        yaxis: {
            title: { text: "Average People in Gym" },
            min: 0,
            decimalsInFloat: 0,
        },
        fill: {
            type: "gradient",
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.7,
                opacityTo: 0.2,
                stops: [0, 90, 100],
            },
        },
        stroke: {
            curve: "smooth",
            width: 3,
        },
        title: {
            text: "Weekly Average Gym Utilization (Last 104 Weeks)",
            align: "left",
        },
        theme: { mode: "dark" },
        tooltip: {
            x: { show: true },
            y: { formatter: (val) => `${toNumber(val).toFixed(1)} people` },
        },
        legend: {
            labels: {
                colors: "#ffffff",
            },
        },
    };

    const series = [
        {
            name: "Weekly Average",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <div className="card bg-dark shadow-lg mb-4">
            <div className="card-header">
                <h5 className="mb-0">Weekly Trend</h5>
            </div>
            <div className="card-body">
                <Suspense
                    fallback={<div className="text-center text-muted py-4">Loading chart...</div>}
                >
                    <ReactApexChart type="area" options={options} series={series} height={300} />
                </Suspense>
            </div>
        </div>
    );
}

function MonthlyChart({ data }: { data: MonthlyDataPoint[] }) {
    const options: ApexOptions = {
        chart: {
            type: "bar",
            height: 350,
            toolbar: { show: true },
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: "60%",
                borderRadius: 4,
            },
        },
        dataLabels: { enabled: false },
        stroke: {
            show: true,
            width: 2,
            colors: ["transparent"],
        },
        xaxis: {
            categories: data.map((d) => d.month),
            labels: {
                rotate: -45,
                rotateAlways: true,
            },
        },
        yaxis: {
            title: { text: "Average People in Gym" },
            min: 0,
            decimalsInFloat: 0,
        },
        fill: { opacity: 1 },
        title: {
            text: "Monthly Average Gym Utilization",
            align: "left",
        },
        theme: { mode: "dark" },
        tooltip: {
            y: { formatter: (val) => `${toNumber(val).toFixed(1)} people` },
        },
    };

    const series = [
        {
            name: "Average People",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <div className="card bg-dark shadow-lg mb-4">
            <div className="card-header">
                <h5 className="mb-0">Monthly Comparison</h5>
            </div>
            <div className="card-body">
                <Suspense
                    fallback={<div className="text-center text-muted py-4">Loading chart...</div>}
                >
                    <ReactApexChart type="bar" options={options} series={series} height={350} />
                </Suspense>
                <div className="mt-3">
                    <small className="text-muted">
                        Peak hours by month:{" "}
                        {data
                            .filter((d) => d.peak_hour !== null)
                            .map((d) => `${d.month}: ${d.peak_hour}:00`)
                            .join(", ") || "No data"}
                    </small>
                </div>
            </div>
        </div>
    );
}

function HourlyPatternChart({ data }: { data: HourlyDataPoint[] }) {
    const maxPeople = data.reduce((max, point) => Math.max(max, point.avg_utilization), 0);
    const lowUpper = maxPeople * 0.33;
    const mediumUpper = maxPeople * 0.66;

    const options: ApexOptions = {
        chart: {
            type: "area",
            height: 300,
            toolbar: { show: true },
        },
        stroke: {
            curve: "smooth",
            width: 3,
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: data.map((d) => `${d.hour}:00`),
            tickPlacement: "on",
        },
        yaxis: {
            title: { text: "Average People in Gym" },
            min: 0,
            decimalsInFloat: 0,
        },
        fill: {
            type: "gradient",
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.7,
                opacityTo: 0.2,
                stops: [0, 90, 100],
            },
        },
        title: {
            text: "Typical Hourly Pattern (Last 6 Months)",
            align: "left",
        },
        theme: { mode: "dark" },
        annotations: {
            yaxis: [
                {
                    y: mediumUpper,
                    y2: maxPeople,
                    fillColor: "#FF0000",
                    opacity: 0.15,
                    label: {
                        text: "High Occupancy",
                        style: { color: "#fff", background: "#FF0000" },
                    },
                },
                {
                    y: lowUpper,
                    y2: mediumUpper,
                    fillColor: "#ff8c00",
                    opacity: 0.15,
                    label: {
                        text: "Medium Occupancy",
                        style: { color: "#fff", background: "#ff8c00" },
                    },
                },
            ],
        },
        tooltip: {
            y: { formatter: (val) => `${toNumber(val).toFixed(1)} people` },
        },
    };

    const series = [
        {
            name: "Average People",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <Suspense fallback={<div className="text-center text-muted py-4">Loading chart...</div>}>
            <ReactApexChart type="area" options={options} series={series} height={300} />
        </Suspense>
    );
}

function DayOfWeekChart({ data }: { data: DayOfWeekDataPoint[] }) {
    // Sort data so Monday is first, Sunday is last
    const sorted = [...data].sort((a, b) => {
        return dayOfWeekToMonFirst(a.day_of_week) - dayOfWeekToMonFirst(b.day_of_week);
    });

    const options: ApexOptions = {
        chart: {
            type: "bar",
            height: 250,
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: "50%",
                borderRadius: 4,
            },
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: sorted.map((d) => DAY_NAMES_MON_FIRST[dayOfWeekToMonFirst(d.day_of_week)]),
        },
        yaxis: {
            title: { text: "Average People in Gym" },
            min: 0,
            decimalsInFloat: 0,
        },
        fill: { opacity: 1 },
        title: {
            text: "Day of Week Pattern",
            align: "left",
        },
        theme: { mode: "dark" },
        tooltip: {
            y: { formatter: (val) => `${toNumber(val).toFixed(1)} people` },
        },
    };

    const series = [
        {
            name: "Average People",
            data: sorted.map((d) => d.avg_utilization),
        },
    ];

    return <ReactApexChart type="bar" options={options} series={series} height={250} />;
}

function HeatmapChart({ data }: { data: HeatmapDataPoint[] }) {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const maxPeople = data.reduce((max, point) => Math.max(max, point.avg_utilization), 0);
    const heatmapMax = maxPeople > 0 ? maxPeople : 1;

    // Build heatmap data with Monday-first ordering
    const heatmapData: { x: number; y: number | null }[][] = [];
    for (let displayDay = 0; displayDay < 7; displayDay++) {
        const row: { x: number; y: number | null }[] = [];
        for (let hour = 0; hour < 24; hour++) {
            // Convert Monday-first display index to API day_of_week (1=Sun..7=Sat)
            const apiDay = monFirstToDayOfWeek(displayDay);
            const point = data.find((d) => d.day_of_week === apiDay && d.hour === hour);
            row.push({ x: hour, y: point ? point.avg_utilization : null });
        }
        heatmapData.push(row);
    }

    const options: ApexOptions = {
        chart: {
            type: "heatmap",
            height: 350,
        },
        theme: { mode: "dark" },
        plotOptions: {
            heatmap: {
                radius: 2,
                colorScale: {
                    inverse: false,
                    min: 0,
                    max: heatmapMax,
                    ranges: Array.from({ length: 100 }, (_, index) => {
                        const from = (heatmapMax * index) / 100;
                        const to = (heatmapMax * (index + 1)) / 100;

                        return {
                            from,
                            to,
                            color: getHeatmapColor((from + to) / 2, heatmapMax),
                        };
                    }),
                },
            },
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: hours.map((h) => `${h}:00`),
            labels: { show: true, rotate: -45 },
        },
        yaxis: {
            categories: DAY_NAMES_MON_FIRST,
            reversed: true,
        } as any,
        title: {
            text: "Utilization Heatmap (Hour x Day)",
            align: "left",
        },
        tooltip: {
            y: {
                formatter: (val) =>
                    val === null || val === undefined
                        ? "No data"
                        : `${toNumber(val).toFixed(1)} people`,
            },
        },
        legend: {
            show: false,
        },
    };

    const series = DAY_NAMES_MON_FIRST.map((day, dayIndex) => ({
        name: day,
        data: heatmapData[dayIndex],
    }));

    return (
        <div className="card bg-dark shadow-lg mb-4">
            <div className="card-header">
                <h5 className="mb-0">Hour x Day Heatmap</h5>
            </div>
            <div className="card-body">
                <Suspense
                    fallback={<div className="text-center text-muted py-4">Loading chart...</div>}
                >
                    <ReactApexChart type="heatmap" options={options} series={series} height={350} />
                </Suspense>
            </div>
        </div>
    );
}

function TrendsPage() {
    const api = useBackendContext();
    const [monthlyData, setMonthlyData] = useState<MonthlyDataPoint[] | null>(null);
    const [hourlyPattern, setHourlyPattern] = useState<HourlyDataPoint[] | null>(null);
    const [dayOfWeekData, setDayOfWeekData] = useState<DayOfWeekDataPoint[] | null>(null);
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[] | null>(null);
    const [weeklyData, setWeeklyData] = useState<HistoryDataPoint[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                // Fetch weekly history (last ~104 weeks = 2 years)
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - 730); // ~2 years

                const [monthly, hourly, weekly] = await Promise.all([
                    api.getGymMonthly(),
                    api.getGymHourlyPattern(),
                    api.getGymHistory(
                        startDate.toISOString().split("T")[0],
                        endDate.toISOString().split("T")[0],
                        "week",
                    ),
                ]);

                setMonthlyData(
                    monthly.data.map((item) => ({
                        ...item,
                        avg_utilization: toNumber(item.avg_utilization),
                        max_utilization: toNumber(item.max_utilization),
                        min_utilization: toNumber(item.min_utilization),
                        total_samples: toNumber(item.total_samples),
                        peak_hour: item.peak_hour === null ? null : toNumber(item.peak_hour),
                    })),
                );
                setHourlyPattern(
                    hourly.hourly.map((item) => ({
                        ...item,
                        hour: toNumber(item.hour),
                        avg_utilization: toNumber(item.avg_utilization),
                        max_utilization: toNumber(item.max_utilization),
                        min_utilization: toNumber(item.min_utilization),
                        sample_count: toNumber(item.sample_count),
                    })),
                );
                setDayOfWeekData(
                    hourly.dayOfWeek.map((item) => ({
                        ...item,
                        day_of_week: toNumber(item.day_of_week),
                        avg_utilization: toNumber(item.avg_utilization),
                        sample_count: toNumber(item.sample_count),
                    })),
                );
                setHeatmapData(
                    hourly.heatmap.map((item) => ({
                        ...item,
                        day_of_week: toNumber(item.day_of_week),
                        hour: toNumber(item.hour),
                        avg_utilization: toNumber(item.avg_utilization),
                        sample_count: toNumber(item.sample_count),
                    })),
                );
                setWeeklyData(
                    weekly.data.map((item) => ({
                        ...item,
                        avg_utilization: toNumber(item.avg_utilization),
                        max_utilization: toNumber(item.max_utilization),
                        min_utilization: toNumber(item.min_utilization),
                        sample_count: toNumber(item.sample_count),
                    })),
                );
                setError(null);
            } catch (err) {
                console.error("Failed to fetch trends data:", err);
                setError("Failed to load trends data. Make sure you're connected to the backend.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [api]);

    if (loading) {
        return (
            <div className="container mt-4">
                <div
                    className="d-flex justify-content-center align-items-center"
                    style={{ height: "50vh" }}
                >
                    <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mt-4">
                <div className="alert alert-danger">{error}</div>
            </div>
        );
    }

    return (
        <div className="container mt-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="text-white mb-0">Gym Occupancy Trends</h1>
                <small className="text-muted">Data aggregated from historical records</small>
            </div>

            <div className="mb-4">
                <Link href="/" className="btn btn-outline-secondary">
                    &larr; Back to Live View
                </Link>
                <button
                    className="btn btn-outline-primary ms-2"
                    onClick={async () => {
                        await navigator.clipboard.writeText(window.location.href);
                        alert("Link copied to clipboard!");
                    }}
                >
                    Share Trends
                </button>
            </div>

            {monthlyData && monthlyData.length > 0 && (
                <>
                    <div className="card bg-dark shadow-lg mb-4">
                        <div className="card-header">
                            <h5 className="mb-0">Key Insights</h5>
                        </div>
                        <div className="card-body">
                            <div className="row text-center">
                                <div className="col-md-4 mb-3">
                                    <h6 className="text-muted mb-2">Busiest Month</h6>
                                    <h4 className="text-white">
                                        {(() => {
                                            const busiest = monthlyData!.reduce(
                                                (max, m) =>
                                                    m.avg_utilization > max.avg_utilization
                                                        ? m
                                                        : max,
                                                monthlyData![0],
                                            );
                                            return busiest ? busiest.month : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            const busiest = monthlyData!.reduce(
                                                (max, m) =>
                                                    m.avg_utilization > max.avg_utilization
                                                        ? m
                                                        : max,
                                                monthlyData![0],
                                            );
                                            return busiest
                                                ? `${busiest.avg_utilization.toFixed(1)} avg people`
                                                : "";
                                        })()}
                                    </small>
                                </div>
                                <div className="col-md-4 mb-3">
                                    <h6 className="text-muted mb-2">Quietest Month</h6>
                                    <h4 className="text-white">
                                        {(() => {
                                            const quietest = monthlyData!.reduce(
                                                (min, m) =>
                                                    m.avg_utilization < min.avg_utilization
                                                        ? m
                                                        : min,
                                                monthlyData![0],
                                            );
                                            return quietest ? quietest.month : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            const quietest = monthlyData!.reduce(
                                                (min, m) =>
                                                    m.avg_utilization < min.avg_utilization
                                                        ? m
                                                        : min,
                                                monthlyData![0],
                                            );
                                            return quietest
                                                ? `${quietest.avg_utilization.toFixed(1)} avg people`
                                                : "";
                                        })()}
                                    </small>
                                </div>
                                <div className="col-md-4 mb-3">
                                    <h6 className="text-muted mb-2">Peak Hour</h6>
                                    <h4 className="text-white">
                                        {(() => {
                                            if (!hourlyPattern || hourlyPattern.length === 0)
                                                return "N/A";
                                            const peak = hourlyPattern.reduce(
                                                (max, h) =>
                                                    h.avg_utilization > max.avg_utilization
                                                        ? h
                                                        : max,
                                                hourlyPattern[0],
                                            );
                                            return peak ? `${peak.hour}:00` : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            if (!hourlyPattern || hourlyPattern.length === 0)
                                                return "";
                                            const peak = hourlyPattern.reduce(
                                                (max, h) =>
                                                    h.avg_utilization > max.avg_utilization
                                                        ? h
                                                        : max,
                                                hourlyPattern[0],
                                            );
                                            return peak
                                                ? `${peak.avg_utilization.toFixed(1)} avg people`
                                                : "";
                                        })()}
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>
                    <MonthlyChart data={monthlyData} />
                </>
            )}

            {weeklyData && weeklyData.length > 0 && <WeeklyLineChart data={weeklyData} />}

            {false && heatmapData && heatmapData.length > 0 && (
                <div className="card bg-dark shadow-lg mb-4">
                    <div className="card-header">
                        <h5 className="mb-0">When to Go</h5>
                    </div>
                    <div className="card-body">
                        <p className="card-text text-white">
                            Based on historical data, the best times to go to the gym are:
                        </p>
                        <div className="row">
                            <div className="col-md-6">
                                <h6 className="text-success mb-2">
                                    🏃 Best Times (Lower Occupancy)
                                </h6>
                                <ul className="list-unstyled">
                                    {heatmapData
                                        // Filter: only well-sampled times, exclude closed hours (0-5am)
                                        .filter(
                                            (d) =>
                                                d.sample_count > 10 && d.hour >= 6 && d.hour <= 23,
                                        )
                                        .sort((a, b) => a.avg_utilization - b.avg_utilization)
                                        .slice(0, 3)
                                        .map((d) => {
                                            const dayNames = [
                                                "Monday",
                                                "Tuesday",
                                                "Wednesday",
                                                "Thursday",
                                                "Friday",
                                                "Saturday",
                                                "Sunday",
                                            ];
                                            // Convert API day_of_week (1=Sun..7=Sat) to Monday-first index
                                            const displayDayIndex = dayOfWeekToMonFirst(
                                                d.day_of_week,
                                            );
                                            return {
                                                day: dayNames[displayDayIndex],
                                                hour: d.hour,
                                                utilization: d.avg_utilization,
                                            };
                                        })
                                        .map((t, i) => (
                                            <li key={i} className="mb-1">
                                                <span className="text-success">✓</span>{" "}
                                                <strong>
                                                    {t.day}s at {t.hour}:00
                                                </strong>{" "}
                                                — {t.utilization.toFixed(1)} avg people
                                            </li>
                                        ))}
                                </ul>
                            </div>
                            <div className="col-md-6">
                                <h6 className="text-danger mb-2">
                                    ⚠️ Times to Avoid (Higher Occupancy)
                                </h6>
                                <ul className="list-unstyled">
                                    {heatmapData
                                        // Filter: only well-sampled times, exclude closed hours
                                        .filter(
                                            (d) =>
                                                d.sample_count > 10 && d.hour >= 6 && d.hour <= 23,
                                        )
                                        .sort((a, b) => b.avg_utilization - a.avg_utilization)
                                        .slice(0, 3)
                                        .map((d) => {
                                            const dayNames = [
                                                "Monday",
                                                "Tuesday",
                                                "Wednesday",
                                                "Thursday",
                                                "Friday",
                                                "Saturday",
                                                "Sunday",
                                            ];
                                            const displayDayIndex = dayOfWeekToMonFirst(
                                                d.day_of_week,
                                            );
                                            return {
                                                day: dayNames[displayDayIndex],
                                                hour: d.hour,
                                                utilization: d.avg_utilization,
                                            };
                                        })
                                        .map((t, i) => (
                                            <li key={i} className="mb-1">
                                                <span className="text-danger">✗</span>{" "}
                                                <strong>
                                                    {t.day}s at {t.hour}:00
                                                </strong>{" "}
                                                — {t.utilization.toFixed(1)} avg people
                                            </li>
                                        ))}
                                </ul>
                            </div>
                        </div>
                        <small className="text-muted">
                            Based on last 6 months of data. Only shows times with sufficient data
                            and during opening hours (6am–midnight).
                        </small>
                    </div>
                </div>
            )}

            <div className="card bg-dark shadow-lg mb-4">
                <div className="card-header">
                    <h5 className="mb-0">Hourly & Weekly Patterns</h5>
                </div>
                <div className="card-body">
                    <div className="row">
                        <div className="col-md-6 mb-3">
                            {hourlyPattern && <HourlyPatternChart data={hourlyPattern} />}
                        </div>
                        <div className="col-md-6 mb-3">
                            {dayOfWeekData && <DayOfWeekChart data={dayOfWeekData} />}
                        </div>
                    </div>
                </div>
            </div>

            {heatmapData && heatmapData.length > 0 && <HeatmapChart data={heatmapData} />}

            <div className="card bg-dark shadow-lg mb-4">
                <div className="card-header">
                    <h5 className="mb-0">About This Data</h5>
                </div>
                <div className="card-body">
                    <small>
                        <ul className="mb-0">
                            <li>Data is collected every 5 minutes from the HSZ booking system.</li>
                            <li>
                                Weekly data shows the last ~104 weeks (2 years) of aggregated
                                averages.
                            </li>
                            <li>Monthly data shows the last 24 months of aggregated averages.</li>
                            <li>Hourly patterns are computed over the last 6 months.</li>
                            <li>Peak hours indicate when the gym is typically most crowded.</li>
                            <li>Chart values represent the average number of people in the gym.</li>
                            <li className="mt-2">
                                <Link href="/" className="btn btn-sm btn-outline-secondary">
                                    Back to Live View
                                </Link>
                            </li>
                        </ul>
                    </small>
                </div>
            </div>
        </div>
    );
}

export default TrendsPage;
