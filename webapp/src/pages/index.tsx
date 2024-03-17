import { Backend, GymResponse } from "@/api/Backend";
import { useBackendContext } from "@/components/BackendProvider";
import { useEffect, useState } from "react";

export default function Home() {
    const [gym, setGym] = useState<GymResponse["data"]>([]);
    const api = useBackendContext();

    useEffect(() => {
        api.getGym().then((res) => {
            setGym(res.data);
        });
    }, [api]);

    return (
        <div>
            <h1>RWTH Gym Auslastung</h1>
            <ul>
                {gym.map((entry) => {
                    return (
                        <li key={entry.created_at}>
                            {entry.auslastung} at {entry.created_at}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
