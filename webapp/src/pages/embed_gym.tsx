import { useSearchParams } from "next/navigation";
import { GymPlotWithHandles } from ".";

export default function EmbedGym() {
    const searchParams = useSearchParams();
    const hideHandles = searchParams.get("hidecontrols") !== null;

    return (
        <div className="p-2">
            <GymPlotWithHandles hideHandles={hideHandles} />
        </div>
    );
}

export const EMBED_CODE = (origin: string) =>
    `<iframe src="${origin}/embed_gym" onload='javascript:(function(o){o.style.height=o.contentWindow.document.body.scrollHeight+"px";}(this));' style="height:580px;width:100%;border:none;overflow:hidden;"></iframe>`;
