import { Backend, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import { useEffect, useState } from "react";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

function ChartImpl({ gym }: { gym: GymResponse }) {
    let data = gym.data_today.map((g) => ({
        ...g,
        created_at: Date.parse(g.created_at),
    }));
    data = data.sort((a, b) => a.created_at - b.created_at);

    gym.data_historic = gym.data_historic || [];
    let historicData = gym.data_historic.map((week, index) =>
        week
            .map((g) => ({
                ...g,
                created_at: Date.parse(g.created_at) + 1000 * 60 * 60 * 24 * 7 * (index + 1),
            }))
            .sort((a, b) => a.created_at - b.created_at),
    );

    // let maxX = data[data.length - 1].created_at + 1000 * 60 * 60 * 10; // 10 hours
    let minX = new Date(data[data.length - 1].created_at).setHours(4, 0, 0, 0);
    let maxX = new Date(data[data.length - 1].created_at).setHours(23, 59, 59, 999);

    const options: ApexOptions = {
        yaxis: {
            min: 0,
            max: (max) => Math.max(160, Math.ceil(max / 10) * 10),
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
            width: [3].concat(new Array(historicData.length).fill(2)),
            dashArray: [0].concat(new Array(historicData.length).fill(2)),
        },
        title: {
            text: "RWTH Gym Auslastung (https://rwtf.dorianko.ch/)",
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
            opacity: [0.3].concat(new Array(historicData.length).fill(0.05)),
        },
    };

    let series: ApexAxisChartSeries = [
        {
            name: "Auslastung",
            zIndex: 1,
            data: data.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        },
    ];
    series = series.concat(
        historicData.map((week, index) => ({
            name: `${index + 1} Week/s ago`,
            data: week.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        })),
    );

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
