import { createContext, useContext, useEffect, useState } from "react";

// "warm" matches dorianko.ch, "classic" is the plain Bootstrap dark look the site had before.
export type Design = "warm" | "classic";

export const DESIGNS: { value: Design; label: string }[] = [
    { value: "warm", label: "New" },
    { value: "classic", label: "Classic" },
];

const STORAGE_KEY = "design";

// Sets <html data-design> before first paint (see _document.tsx), so a saved "classic" doesn't
// flash the default design. The CSS keys off that attribute, not React state.
export const DESIGN_INIT_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="classic")document.documentElement.dataset.design="classic"}catch(e){}`;

// Text and grid-line colours for ApexCharts, which takes colours as options instead of CSS.
export const CHART_COLORS: Record<Design, { text: string; grid: string }> = {
    warm: { text: "#ebe5da", grid: "#5a5249" },
    classic: { text: "#ffffff", grid: "#636363" },
};

interface DesignContextValue {
    design: Design;
    setDesign: (design: Design) => void;
}

const DesignContext = createContext<DesignContextValue>({ design: "warm", setDesign: () => {} });

export function DesignProvider({ children }: { children: React.ReactNode }) {
    const [design, setDesignState] = useState<Design>("warm");

    // Pages are prerendered, so the saved choice can only be read on the client.
    useEffect(() => {
        if (document.documentElement.dataset.design === "classic") setDesignState("classic");
    }, []);

    const setDesign = (next: Design) => {
        setDesignState(next);
        if (next === "classic") document.documentElement.dataset.design = "classic";
        else delete document.documentElement.dataset.design;
        try {
            if (next === "classic") localStorage.setItem(STORAGE_KEY, next);
            else localStorage.removeItem(STORAGE_KEY);
        } catch {
            // storage blocked: the choice just lasts until the page is reloaded
        }
    };

    return (
        <DesignContext.Provider value={{ design, setDesign }}>{children}</DesignContext.Provider>
    );
}

export function useDesign() {
    return useContext(DesignContext);
}

export function useChartColors() {
    return CHART_COLORS[useDesign().design];
}
