import { Backend, GymInterpLineResponse, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import { useEffect, useState } from "react";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

function ChartImpl({ gym, gymLine }: { gym: GymResponse; gymLine: GymInterpLineResponse }) {
    const chartRef = React.createRef<any>();

    // hide historic data by default
    useEffect(() => {
        if (chartRef.current) {
            for (let i = 0; i < gym.data_historic.length; i++) {
                chartRef.current.chart.hideSeries(`${i + 1} Week/s ago`);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartRef]);

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

    let minX, maxX;

    if (data.length > 0) {
        minX = new Date(data[data.length - 1].created_at).setHours(6, 0, 0, 0);
        maxX = new Date(data[data.length - 1].created_at).setHours(23, 59, 59, 999);
    } else if (historicData.length > 0 && historicData[historicData.length - 1].length > 0) {
        minX = new Date(historicData[historicData.length - 1][0].created_at).setHours(6, 0, 0, 0);
        maxX = new Date(historicData[historicData.length - 1][0].created_at).setHours(
            23,
            59,
            59,
            999,
        );
    } else {
        return <div>No data</div>;
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
            width: [3, 2].concat(new Array(historicData.length).fill(1)),
            dashArray: [0, 1].concat(new Array(historicData.length).fill(3)),
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
            opacity: [0.4, 0.15].concat(new Array(historicData.length).fill(0.02)),
        },
        annotations: {
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

    let series: ApexAxisChartSeries = [
        {
            name: "Auslastung",
            zIndex: 1,
            data: data.map((g) => ({
                x: g.created_at,
                y: g.auslastung,
            })),
        },
        {
            name: "Historic Avg",
            data: gymLine.interpLine.map((g) => {
                const gDate = new Date(g.created_at);
                return {
                    x: +new Date(minX).setHours(
                        gDate.getHours(),
                        gDate.getMinutes(),
                        gDate.getSeconds(),
                        gDate.getMilliseconds(),
                    ),
                    y: g.auslastung,
                };
            }),
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
        <ReactApexChart
            type="area"
            width={"100%"}
            height={500}
            options={options}
            series={series}
            ref={chartRef}
        />
    );
}

function GymStuff() {
    const [gym, setGym] = useState<GymResponse>();
    const [gymLine, setGymLine] = useState<GymInterpLineResponse>();
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const [dayoffset, setDayoffset] = useState(0);
    const api = useBackendContext();

    const days = ["Today", "+1 day", "+2 days", "+3 days"];

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
                {gym && gymLine && <ChartImpl gym={gym} gymLine={gymLine} />}
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
                        This Website is <a href="https://github.com/dorian-K/rwtf">open-source</a>!
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

    const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
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
