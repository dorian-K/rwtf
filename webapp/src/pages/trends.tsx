import React, { useEffect, useState } from "react";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import {
    MonthlyDataPoint,
    HourlyDataPoint,
    DayOfWeekDataPoint,
    HeatmapDataPoint,
} from "@/api/Backend";

const ReactApexChart = React.lazy(() => import("apexcharts"));

function MonthlyChart({ data }: { data: MonthlyDataPoint[] }) {
    const options: ApexOptions = {
        chart: {
            type: "bar",
            height: 350,
            toolbar: {
                show: true,
            },
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: "60%",
                borderRadius: 4,
            },
        },
        dataLabels: {
            enabled: false,
        },
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
            title: {
                text: "Avg Utilization (%)",
            },
            min: 0,
            max: 100,
        },
        fill: {
            opacity: 1,
        },
        title: {
            text: "Monthly Average Gym Utilization",
            align: "left",
        },
        theme: {
            mode: "dark",
        },
        tooltip: {
            y: {
                formatter: (val) => `${val.toFixed(1)}%`,
            },
        },
    };

    const series = [
        {
            name: "Avg Utilization",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <div className="card bg-dark shadow-lg mb-4">
            <div className="card-header">
                <h5 className="mb-0">Monthly Comparison</h5>
            </div>
            <div className="card-body">
                <ReactApexChart
                    type="bar"
                    options={options}
                    series={series}
                    height={350}
                />
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
    const options: ApexOptions = {
        chart: {
            type: "area",
            height: 300,
            toolbar: {
                show: true,
            },
        },
        stroke: {
            curve: "smooth",
            width: 3,
        },
        dataLabels: {
            enabled: false,
        },
        xaxis: {
            categories: data.map((d) => `${d.hour}:00`),
            tickPlacement: "on",
        },
        yaxis: {
            title: {
                text: "Avg Utilization (%)",
            },
            min: 0,
            max: 100,
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
        theme: {
            mode: "dark",
        },
        annotations: {
            yaxis: [
                {
                    y: 160,
                    y2: 100,
                    fillColor: "#FF0000",
                    opacity: 0.15,
                    label: {
                        text: "High",
                        style: {
                            color: "#fff",
                            background: "#FF0000",
                        },
                    },
                },
                {
                    y: 120,
                    y2: 80,
                    fillColor: "#ff8c00",
                    opacity: 0.15,
                    label: {
                        text: "Medium",
                        style: {
                            color: "#fff",
                            background: "#ff8c00",
                        },
                    },
                },
            ],
        },
        tooltip: {
            y: {
                formatter: (val) => `${val.toFixed(1)}%`,
            },
        },
    };

    const series = [
        {
            name: "Avg Utilization",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <ReactApexChart
            type="area"
            options={options}
            series={series}
            height={300}
        />
    );
}

function DayOfWeekChart({ data }: { data: DayOfWeekDataPoint[] }) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        dataLabels: {
            enabled: false,
        },
        xaxis: {
            categories: data.map((d) => dayNames[d.day_of_week - 1] || `Day ${d.day_of_week}`),
        },
        yaxis: {
            title: {
                text: "Avg Utilization (%)",
            },
            min: 0,
            max: 100,
        },
        fill: {
            opacity: 1,
        },
        title: {
            text: "Day of Week Pattern",
            align: "left",
        },
        theme: {
            mode: "dark",
        },
        tooltip: {
            y: {
                formatter: (val) => `${val.toFixed(1)}%`,
            },
        },
    };

    const series = [
        {
            name: "Avg Utilization",
            data: data.map((d) => d.avg_utilization),
        },
    ];

    return (
        <ReactApexChart
            type="bar"
            options={options}
            series={series}
            height={250}
        />
    );
}

function HeatmapChart({ data }: { data: HeatmapDataPoint[] }) {
    // Prepare data for heatmap
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = Array.from({ length: 24 }, (_, i) => i);

    // Group by day and hour
    const heatmapData: number[][] = [];
    for (let day = 1; day <= 7; day++) {
        const row: number[] = [];
        for (let hour = 0; hour < 24; hour++) {
            const point = data.find(
                (d) => d.day_of_week === day && d.hour === hour
            );
            row.push(point ? point.avg_utilization : 0);
        }
        heatmapData.push(row);
    }

    const options: ApexOptions = {
        chart: {
            type: "heatmap",
            height: 350,
        },
        plotOptions: {
            heatmap: {
                radius: 2,
                colorScale: {
                    ranges: [
                        { from: 0, to: 40, name: "Low", color: "#00A100" },
                        { from: 41, to: 80, name: "Medium", color: "#FF8C00" },
                        { from: 81, to: 100, name: "High", color: "#FF0000" },
                    ],
                },
            },
        },
        dataLabels: {
            enabled: false,
        },
        xaxis: {
            categories: hours.map((h) => `${h}:00`),
            labels: {
                show: true,
                rotate: -45,
                formatter: (val) => val,
            },
        },
        yaxis: {
            categories: dayNames,
            reversed: true,
        },
        title: {
            text: "Utilization Heatmap (Hour x Day)",
            align: "left",
        },
        tooltip: {
            y: {
                formatter: (val) => `${val.toFixed(1)}%`,
            },
        },
    };

    const series = dayNames.map((day, dayIndex) => ({
        name: day,
        data: heatmapData[dayIndex],
    }));

    return (
        <div className="card bg-dark shadow-lg mb-4">
            <div className="card-header">
                <h5 className="mb-0">Hour x Day Heatmap</h5>
            </div>
            <div className="card-body">
                <ReactApexChart
                    type="heatmap"
                    options={options}
                    series={series}
                    height={350}
                />
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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [monthly, hourly] = await Promise.all([
                    api.getGymMonthly(),
                    api.getGymHourlyPattern(),
                ]);
                setMonthlyData(monthly.data);
                setHourlyPattern(hourly.hourly);
                setDayOfWeekData(hourly.dayOfWeek);
                setHeatmapData(hourly.heatmap);
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
                <div className="d-flex justify-content-center align-items-center" style={{ height: "50vh" }}>
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
                <h1 className="text-white mb-0">Gym Utilization Trends</h1>
                <small className="text-muted">Data aggregated from historical records</small>
            </div>

            <div className="mb-4">
                <a href="/" className="btn btn-outline-secondary">
                    &larr; Back to Live View
                </a>
            </div>

            {monthlyData && monthlyData.length > 0 ? (
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
                                            const busiest = monthlyData!.reduce((max, m) => 
                                                m.avg_utilization > max.avg_utilization ? m : max, monthlyData![0]);
                                            return busiest ? busiest.month : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            const busiest = monthlyData!.reduce((max, m) => 
                                                m.avg_utilization > max.avg_utilization ? m : max, monthlyData![0]);
                                            return busiest ? `${busiest.avg_utilization.toFixed(1)}% avg` : "";
                                        })()}
                                    </small>
                                </div>
                                <div className="col-md-4 mb-3">
                                    <h6 className="text-muted mb-2">Quietest Month</h6>
                                    <h4 className="text-white">
                                        {(() => {
                                            const quietest = monthlyData!.reduce((min, m) => 
                                                m.avg_utilization < min.avg_utilization ? m : min, monthlyData![0]);
                                            return quietest ? quietest.month : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            const quietest = monthlyData!.reduce((min, m) => 
                                                m.avg_utilization < min.avg_utilization ? m : min, monthlyData![0]);
                                            return quietest ? `${quietest.avg_utilization.toFixed(1)}% avg` : "";
                                        })()}
                                    </small>
                                </div>
                                <div className="col-md-4 mb-3">
                                    <h6 className="text-muted mb-2">Peak Hour</h6>
                                    <h4 className="text-white">
                                        {(() => {
                                            if (!hourlyPattern || hourlyPattern.length === 0) return "N/A";
                                            const peak = hourlyPattern.reduce((max, h) => 
                                                h.avg_utilization > max.avg_utilization ? h : max, hourlyPattern[0]);
                                            return peak ? `${peak.hour}:00` : "N/A";
                                        })()}
                                    </h4>
                                    <small className="text-muted">
                                        {(() => {
                                            if (!hourlyPattern || hourlyPattern.length === 0) return "";
                                            const peak = hourlyPattern.reduce((max, h) => 
                                                h.avg_utilization > max.avg_utilization ? h : max, hourlyPattern[0]);
                                            return peak ? `${peak.avg_utilization.toFixed(1)}% avg` : "";
                                        })()}
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>
                    <MonthlyChart data={monthlyData} />
                </>
            ) : (
                <div className="alert alert-info">No monthly data available yet.</div>
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

            {heatmapData && heatmapData.length > 0 && (
                <HeatmapChart data={heatmapData} />
            )}

            <div className="card bg-dark shadow-lg mb-4">
                <div className="card-header">
                    <h5 className="mb-0">About This Data</h5>
                </div>
                <div className="card-body">
                    <small>
                        <ul className="mb-0">
                            <li>Data is collected every 5 minutes from the HSZ booking system.</li>
                            <li>Monthly data shows the last 24 months of aggregated averages.</li>
                            <li>Hourly patterns are computed over the last 6 months.</li>
                            <li>Peak hours indicate when the gym is typically most crowded.</li>
                            <li>Red zones on charts indicate high utilization (>80%).</li>
                            <li className="mt-2">
                                <a href="/" className="btn btn-sm btn-outline-secondary">Back to Live View</a>{" "}
                                <a href="/api/v1/gym/export?start_date=2026-01-01&end_date=2026-01-31&format=csv" className="btn btn-sm btn-outline-primary" download>Export Data (CSV)</a>
                            </li>
                        </ul>
                    </small>
                </div>
            </div>
        </div>
    );
}

export default TrendsPage;
