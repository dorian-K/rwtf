import React, { useEffect, useState } from "react";
import { GymInterpLineResponse, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";

function TrafficLight({ gym, gymLine }: { gym: GymResponse; gymLine: GymInterpLineResponse }) {
    // Current utilization — sort by timestamp to ensure we get the latest point
    const latestDataPoint =
        gym.data_today.length > 0
            ? [...gym.data_today].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              )[gym.data_today.length - 1]
            : null;
    const currentUtil = latestDataPoint ? latestDataPoint.auslastung : null;

    // Go / Wait decision
    const getGoWait = () => {
        if (currentUtil === null || !gymLine?.interpLine) return null;
        // eslint-disable-next-line react-hooks/purity
        const target = new Date(Date.now() + 3600000);
        let closestPoint = gymLine.interpLine[0];
        let minDiff = Infinity;
        for (const p of gymLine.interpLine) {
            const diff = Math.abs(new Date(p.created_at).getTime() - target.getTime());
            if (diff < minDiff) {
                minDiff = diff;
                closestPoint = p;
            }
        }
        const nextHour = closestPoint?.auslastung ?? currentUtil;

        if (currentUtil < 40) {
            return { decision: "GO", emoji: "🏃", color: "success", text: "Perfect time!" };
        }
        if (currentUtil < 60 && nextHour < currentUtil) {
            return { decision: "GO", emoji: "🏃", color: "success", text: "Getting quieter!" };
        }
        return { decision: "WAIT", emoji: "⏰", color: "warning", text: "Busy right now" };
    };
    const goWait = getGoWait();

    // Quick time slots: Now, 1h, 2h
    const getTimeSlots = () => {
        if (!gymLine?.interpLine || gymLine.interpLine.length === 0) return [];
        const now = new Date();
        const slots = [];
        for (let i = 0; i <= 2; i++) {
            const target = new Date(now.getTime() + i * 3600000);
            let closest = gymLine.interpLine[0];
            let minDiff = Infinity;
            for (const p of gymLine.interpLine) {
                const diff = Math.abs(new Date(p.created_at).getTime() - target.getTime());
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = p;
                }
            }
            slots.push({ label: i === 0 ? "Now" : `${i}h`, value: closest?.auslastung ?? 0 });
        }
        return slots;
    };
    const timeSlots = getTimeSlots();

    const getStatusColor = (util: number) => {
        if (util < 40) return "text-success";
        if (util < 65) return "text-warning";
        return "text-danger";
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#1a1a1a",
                color: "white",
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}
        >
            {goWait && (
                <div
                    style={{
                        padding: "2rem 3rem",
                        borderRadius: "1rem",
                        backgroundColor:
                            goWait.color === "success"
                                ? "#198754"
                                : goWait.color === "warning"
                                  ? "#ffc107"
                                  : "#dc3545",
                        color: goWait.color === "warning" ? "#000" : "#fff",
                        textAlign: "center",
                        marginBottom: "2rem",
                        boxShadow: "0 0 60px rgba(0,0,0,0.5)",
                    }}
                >
                    <div style={{ fontSize: "5rem", marginBottom: "1rem" }}>{goWait.emoji}</div>
                    <div style={{ fontSize: "3rem", fontWeight: "bold", marginBottom: "0.5rem" }}>
                        {goWait.decision}
                    </div>
                    <div style={{ fontSize: "1.5rem" }}>{goWait.text}</div>
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    gap: "3rem",
                    textAlign: "center",
                }}
            >
                {timeSlots.map((slot) => (
                    <div key={slot.label}>
                        <div style={{ fontSize: "1.2rem", color: "#888", marginBottom: "0.5rem" }}>
                            {slot.label}
                        </div>
                        <div
                            style={{
                                fontSize: "2.5rem",
                                fontWeight: "bold",
                                ...(getStatusColor(slot.value) === "text-success"
                                    ? { color: "#198754" }
                                    : getStatusColor(slot.value) === "text-warning"
                                      ? { color: "#ffc107" }
                                      : { color: "#dc3545" }),
                            }}
                        >
                            {slot.value.toFixed(0)}%
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: "3rem", color: "#666", fontSize: "0.9rem" }}>
                Updated{" "}
                {latestDataPoint ? new Date(latestDataPoint.created_at).toLocaleTimeString() : "—"}
            </div>
        </div>
    );
}

export default function TrafficPage() {
    const [gym, setGym] = useState<GymResponse>();
    const [gymLine, setGymLine] = useState<GymInterpLineResponse>();
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const api = useBackendContext();

    const reloadData = () => {
        setIsLoading(true);
        Promise.all([api.getGym(0), api.getGymInterpLine(0, "closest")])
            .then((res) => {
                setGym(res[0]);
                setGymLine(res[1]);
                setError(undefined);
            })
            .catch((err) => {
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

        return () => clearInterval(tim);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);

    if (error) {
        return (
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#1a1a1a",
                    color: "#dc3545",
                    fontFamily: "system-ui",
                }}
            >
                <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
                    <div>{error}</div>
                </div>
            </div>
        );
    }

    if (isLoading || !gym || !gymLine) {
        return (
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#1a1a1a",
                    color: "white",
                    fontFamily: "system-ui",
                }}
            >
                <div style={{ textAlign: "center" }}>
                    <div
                        className="spinner-border"
                        style={{ width: "3rem", height: "3rem", marginBottom: "1rem" }}
                    ></div>
                    <div>Loading...</div>
                </div>
            </div>
        );
    }

    return <TrafficLight gym={gym} gymLine={gymLine} />;
}
