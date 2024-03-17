import { Backend, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { ApexOptions } from "apexcharts";
import React from "react";
import { useEffect, useState } from "react";

const ReactApexChart = React.lazy(() => import("react-apexcharts"));

export default function Home() {
    const [gym, setGym] = useState<GymResponse["data"]>([]);
    const api = useBackendContext();

    useEffect(() => {
        api.getGym().then((res) => {
            setGym(res.data);
        });
    }, [api]);

    if (gym.length === 0) {
        return <div>Loading...</div>;
    }

    let data = gym.map((g) => ({
        ...g,
        created_at: Date.parse(g.created_at),
    }));
    data = data.sort((a, b) => a.created_at - b.created_at);
    let maxX = data[data.length - 1].created_at + 1000 * 60 * 60 * 6; // 6 hours
    let range = 1000 * 60 * 60 * 24; // 1 day

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
    ];

    return (
        <div className="container">
            <div className="card mt-3">
                <div className="card-body">
                    <ReactApexChart
                        type="area"
                        width={"100%"}
                        height={500}
                        options={options}
                        series={series}
                    />
                </div>
            </div>
        </div>
    );
}
