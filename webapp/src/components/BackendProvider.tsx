import { Backend } from "@/api/Backend";
import { createContext, useContext, useEffect, useState } from "react";

const BackendContext = createContext<Backend>(new Backend());

export function BackendProvider({ children }: { children: React.ReactNode }) {
    let [state, setState] = useState(() => new Backend());

    return <BackendContext.Provider value={state}>{children}</BackendContext.Provider>;
}
export function useBackendContext() {
    return useContext(BackendContext);
}
