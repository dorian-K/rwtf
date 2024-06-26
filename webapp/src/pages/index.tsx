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
    let minX = undefined,
        maxX = undefined;
    if (data.length > 0) {
        minX = new Date(data[data.length - 1].created_at).setHours(6, 0, 0, 0);
        maxX = new Date(data[data.length - 1].created_at).setHours(23, 59, 59, 999);
    }

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
        fill: {
            type: "solid",
            opacity: [0.3].concat(new Array(historicData.length).fill(0.05)),
        },
        annotations: {
            texts: [
                {
                    x: 200,
                    y: 100,
                    text: "rwtf.dorianko.ch",
                    textAnchor: "start",
                    fontSize: "30px",
                    foreColor: "#888",
                },
            ],
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
    const [dayoffset, setDayoffset] = useState(0);
    const api = useBackendContext();

    const days = ["Today", "+1 day", "+2 days", "+3 days"];

    const reloadData = () => {
        setIsLoading(true);
        api.getGym(dayoffset)
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

    useEffect(() => {
        //import("bootstrap/js/dist/");
    }, []);

    return (
        <div className="container">
            <div className="card mt-3">
                <div className="card-header">
                    RWTH Gym Auslastung (
                    <a href="https://buchung.hsz.rwth-aachen.de/angebote/aktueller_zeitraum/_Auslastung.html">
                        Datenquelle
                    </a>
                    ,{" "}
                    <a href="https://hochschulsport.rwth-aachen.de/cms/HSZ/Sport/Sportanlagen/Sportzentrum-Koenigshuegel/~jpwb/RWTH-GYM/">
                        Öffnungszeiten
                    </a>
                    )
                </div>
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
                    <div className="mt-2">
                        <small>
                            This Website is{" "}
                            <a href="https://github.com/dorian-K/rwtf">open-source</a>!
                        </small>
                    </div>
                </div>
            </div>
        </div>
    );
}
