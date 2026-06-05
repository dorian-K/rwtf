import React, { useEffect, useState, Suspense, lazy } from "react";
import Link from "next/link";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import { WifiBuildingResponse } from "@/api/Backend";

const ReactApexChart = lazy(() =>
    import("react-apexcharts").then((m) => ({
        default: m.default as unknown as React.ComponentType<any>,
    })),
);

function WifiChart({ data, hours }: { data: WifiBuildingResponse; hours: number }) {
    const { current, history, building } = data;

    const lastUpdated = current.last_updated
        ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(current.last_updated),
          )
        : null;

    const rangeLabel = hours <= 24 ? "Last 24 h" : hours <= 48 ? "Last 48 h" : "Last 7 days";

    const options: ApexOptions = {
        chart: {
            type: "area",
            animations: { enabled: false },
        },
        xaxis: {
            type: "datetime",
            labels: { datetimeUTC: false },
        },
        yaxis: {
            min: 0,
            decimalsInFloat: 0,
            title: { text: "Connected Devices" },
        },
        title: {
            text: `WiFi Usage · ${building} · ${rangeLabel}`,
            align: "left",
        },
        theme: { mode: "dark" },
        tooltip: { x: { format: "dd.MM.yyyy HH:mm" } },
        stroke: { curve: "smooth", width: 2 },
        fill: { type: "solid", opacity: 0.2 },
        dataLabels: { enabled: false },
        grid: {
            borderColor: "#636363",
            xaxis: { lines: { show: true } },
        },
        noData: { text: "No data for this range", style: { color: "#aaa" } },
    };

    const series: ApexOptions["series"] = [
        {
            name: "Connected Devices",
            data: history.map((h) => ({ x: new Date(h.time).getTime(), y: h.total_users })),
        },
    ];

    return (
        <>
            <div className="d-flex gap-4 mb-3 small text-muted">
                <span>
                    <strong className="text-white fs-5">{current.total_users}</strong> devices now
                </span>
                <span>
                    {current.active_aps} / {current.total_aps} APs online
                </span>
                {lastUpdated && <span>Updated {lastUpdated}</span>}
            </div>
            <div style={{ height: "400px" }}>
                <Suspense fallback={<div className="spinner-border"></div>}>
                    <ReactApexChart
                        type="area"
                        width="100%"
                        height={400}
                        options={options}
                        series={series}
                    />
                </Suspense>
            </div>
        </>
    );
}

function WifiStuff() {
    const [buildings, setBuildings] = useState<string[]>([]);
    const [buildingsLoading, setBuildingsLoading] = useState(true);
    const [selectedBuilding, setSelectedBuilding] = useState<string>("");
    const [hours, setHours] = useState(24);
    const [data, setData] = useState<WifiBuildingResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const api = useBackendContext();

    useEffect(() => {
        api.getWifiBuildings()
            .then((resp) => {
                setBuildings(resp.buildings);
                if (resp.buildings.length > 0) setSelectedBuilding(resp.buildings[0]);
            })
            .catch((e) => setError(String(e)))
            .finally(() => setBuildingsLoading(false));
    }, [api]);

    const loadData = () => {
        if (!selectedBuilding) return;
        setIsLoading(true);
        api.getWifiBuilding(selectedBuilding, hours)
            .then((d) => {
                setData(d);
                setError(null);
            })
            .catch((e) => setError(String(e)))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        loadData();
        const tim = setInterval(loadData, 1000 * 60 * 5);
        return () => clearInterval(tim);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, selectedBuilding, hours]);

    const timeRanges: { label: string; value: number }[] = [
        { label: "24 h", value: 24 },
        { label: "48 h", value: 48 },
        { label: "7 days", value: 168 },
    ];

    return (
        <div className="card mt-3">
            <div className="card-header">WiFi Usage by Building</div>
            <div className="card-body">
                {error && <div className="alert alert-danger">{error}</div>}
                {buildingsLoading && <div className="spinner-border spinner-border-sm me-2"></div>}
                {!buildingsLoading && buildings.length === 0 && (
                    <p className="text-muted">No WiFi data available yet.</p>
                )}
                {buildings.length > 0 && (
                    <>
                        <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
                            <div className="input-group" style={{ maxWidth: "320px" }}>
                                <label className="input-group-text" htmlFor="buildingSelect">
                                    Building
                                </label>
                                <select
                                    className="form-select"
                                    id="buildingSelect"
                                    value={selectedBuilding}
                                    onChange={(e) => setSelectedBuilding(e.target.value)}
                                >
                                    {buildings.map((b) => (
                                        <option key={b} value={b}>
                                            {b}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="btn-group" role="group">
                                {timeRanges.map((r) => (
                                    <button
                                        key={r.value}
                                        type="button"
                                        className={`btn btn-outline-secondary${hours === r.value ? " active" : ""}`}
                                        onClick={() => setHours(r.value)}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                className="btn btn-primary"
                                onClick={loadData}
                                disabled={isLoading}
                            >
                                Reload
                            </button>
                            {isLoading && <div className="spinner-border spinner-border-sm"></div>}
                        </div>
                        {data && <WifiChart data={data} hours={hours} />}
                    </>
                )}
            </div>
        </div>
    );
}

export default function WifiPage() {
    return (
        <div className="container">
            <div className="mt-3">
                <Link href="/" className="btn btn-outline-secondary btn-sm">
                    ← Back to Gym
                </Link>
            </div>
            <WifiStuff />
            <div className="mt-3">
                <small className="text-muted">
                    Aggregated connected-device counts across all access points in a building.
                    Access points that stop reporting are dropped from the live totals; ones
                    reporting as offline count toward the AP total but not the active count.
                </small>
            </div>
        </div>
    );
}
