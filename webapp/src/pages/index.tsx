import { Backend, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import { useEffect, useState } from "react";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

function ChartImpl({ gym }: { gym: GymResponse }) {
    let data = gym.data.map((g) => ({
        ...g,
        created_at: Date.parse(g.created_at),
    }));
    data = data.sort((a, b) => a.created_at - b.created_at);
    let maxX = data[data.length - 1].created_at + 1000 * 60 * 60 * 10; // 10 hours
    let range = 1000 * 60 * 60 * 24; // 1 day

    let dataAvg = gym.data_lastweek.map((g) => ({
        ...g,
        created_at: Date.parse(g.created_at) + 1000 * 60 * 60 * 24 * 7,
    }));
    dataAvg = dataAvg.sort((a, b) => a.created_at - b.created_at);

    const options: ApexOptions = {
        yaxis: {
            min: 0,
            max: (max) => Math.max(150, Math.ceil(max / 10) * 10),
            decimalsInFloat: 0,
            tickAmount: 6,
        },
        xaxis: {
            type: "datetime",
            min: maxX - range,
            max: maxX,
            labels: {
                datetimeUTC: false,
            },
        },
        chart: {
            id: "gym",
            animations: {
                enabled: false,
            },
        },
        dataLabels: {
            enabled: false,
        },
        stroke: {
            curve: "smooth",
        },
        title: {
            text: "RWTH Gym Auslastung",
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
    };

    const series: ApexAxisChartSeries = [
        {
            name: "Auslastung",
            data: data.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        },
        {
            name: "Letzte Woche",
            data: dataAvg.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        },
    ];

    return (
        <ReactApexChart type="area" width={"100%"} height={500} options={options} series={series} />
    );
}

export default function Home() {
    const [gym, setGym] = useState<GymResponse>();
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const api = useBackendContext();

    const reloadData = () => {
        setIsLoading(true);
        api.getGym()
            .then((res) => {
                setGym(res);
                setError(undefined);
            })
            .catch((err) => {
                setGym(undefined);
                setError(err + "");
            })
            .then(() => {
                setIsLoading(false);
            });
    };

    useEffect(() => {
        reloadData();

        const tim = setInterval(() => {
            reloadData();
        }, 1000 * 60); // 1 minute

        return () => {
            clearInterval(tim);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);

    return (
        <div className="container">
            <div className="card mt-3">
                <div className="card-body">
                    {error && <div className="alert alert-danger">{error}</div>}

                    {gym && <ChartImpl gym={gym} />}

                    <div className="d-flex mt-3 ">
                        <button
                            className="btn btn-primary me-2"
                            onClick={reloadData}
                            disabled={isLoading}
                        >
                            Reload
                        </button>
                        {isLoading && <div className="spinner-border"></div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
