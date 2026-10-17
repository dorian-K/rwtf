export interface GymDataPiece {
    auslastung: number;
    created_at: string;
    // Confidence bands around the prediction (present only on prediction points): lower/upper is the
    // tight 50% band, lowerWide/upperWide the full range.
    lower?: number;
    upper?: number;
    lowerWide?: number;
    upperWide?: number;
}

export interface GymResponse {
    data_today: GymDataPiece[];
    data_historic: GymDataPiece[][];
}

// "closest" = similar-weeks predictor, "timestral" = Mistral's Timestral foundation model.
export type GymPredictionMethod = "closest" | "timestral";

export interface GymInterpLineResponse {
    interpLine: GymDataPiece[];
    allTimeHigh: number;
}

export interface HistoryDataPoint {
    time_bucket: string;
    avg_utilization: number;
    max_utilization: number;
    min_utilization: number;
    sample_count: number;
}

export interface MonthlyDataPoint {
    month: string;
    avg_utilization: number;
    max_utilization: number;
    min_utilization: number;
    total_samples: number;
    peak_hour: number | null;
}

export interface HourlyDataPoint {
    hour: number;
    avg_utilization: number;
    max_utilization: number;
    min_utilization: number;
    sample_count: number;
}

export interface DayOfWeekDataPoint {
    day_of_week: number;
    avg_utilization: number;
    sample_count: number;
}

export interface HeatmapDataPoint {
    day_of_week: number;
    hour: number;
    avg_utilization: number;
    sample_count: number;
}

export interface HourlyPatternResponse {
    hourly: HourlyDataPoint[];
    dayOfWeek: DayOfWeekDataPoint[];
    heatmap: HeatmapDataPoint[];
    queryMs: number;
}

export interface WifiBuildingCurrent {
    total_users: number;
    active_aps: number;
    total_aps: number;
    last_updated: string | null;
}

export interface WifiBuildingHistoryPoint {
    time: string;
    total_users: number;
    active_aps: number;
}

export interface WifiBuildingResponse {
    building: string;
    current: WifiBuildingCurrent;
    history: WifiBuildingHistoryPoint[];
    queryMs: number;
}

export interface WifiSeriesPoint {
    value: number;
    // Actual points arrive as datetime strings; predicted points as epoch-ms numbers.
    created_at: string | number;
    // Confidence bands around the prediction (present only on prediction points): lower/upper is the
    // tight 50% band, lowerWide/upperWide the full range.
    lower?: number;
    upper?: number;
    lowerWide?: number;
    upperWide?: number;
}

export interface WifiBuildingPredictResponse {
    building: string;
    dataToday: WifiSeriesPoint[];
    interpLine: WifiSeriesPoint[];
    dayoffset: number;
}

export interface StudyFileResult {
    id: number;
    study_id: string;
    filename: string;
    course_name: string;
    file_type: number;
    university_name: string;
    professor_name: string;
    semester_label: string;
    download_count: number;
    // StudyDrive's upload date (from the stored blob); may be missing/unparseable.
    uploaded_at: string | null;
    downloadUrl: string;
}

export interface StudySearchResponse {
    error: boolean;
    results: StudyFileResult[];
    page: number;
    page_size: number;
    has_more: boolean;
}

export interface StudyInspectResponse {
    error: boolean;
    file: StudyFileResult & { path: string };
    metadata: Record<string, any> | null;
}

// `code` mirrors the backend's error codes ("unknown_type", "upstream", "invalid_url",
// "not_aachen", "internal") plus "network" for a request that never made it there.
export class StudyDownloadError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

// Pull the filename out of Content-Disposition, preferring the RFC 5987 form (which survives
// umlauts) over the ASCII fallback. Returns null if the header is absent or unparseable.
function filenameFromDisposition(header: string | null): string | null {
    if (!header) return null;
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1]);
        } catch {
            // fall through to the plain form
        }
    }
    const plain = /filename="([^"]+)"/i.exec(header);
    return plain ? plain[1] : null;
}

export class Backend {
    fetch(input: string, init?: RequestInit): Promise<Response> {
        return fetch(input, init);
    }

    private processResponse<T>(response: Promise<Response>): Promise<T> {
        return response
            .then((res) => {
                if (!res.ok) {
                    // Attempt to parse the response as json to check for api_error
                    return res.json().then((errorBody) => {
                        throw new Error(`${res.statusText}, invalid error, url=${res.url}`);
                    });
                }
                return res.json();
            })
            .catch((error) => {
                console.error("API call failed:", error);
                throw error;
            });
    }

    getGym(dayoffset: number): Promise<GymResponse> {
        return this.processResponse(this.fetch("/api/v1/gym?dayoffset=" + dayoffset));
    }

    getGymInterpLine(
        dayoffset: number,
        method: GymPredictionMethod = "closest",
    ): Promise<GymInterpLineResponse> {
        return this.processResponse(
            this.fetch(`/api/v1/gym_interpline?dayoffset=${dayoffset}&method=${method}`),
        );
    }

    isAachener(): Promise<boolean> {
        return this.processResponse(this.fetch("/api/v1/is_aachen")).then(
            (data: any) => data.status,
        );
    }

    getStudyUrl(url: string): string {
        return `/api/v1/study?url=${encodeURIComponent(url)}`;
    }

    // Fetch the document as a blob rather than navigating to it. Navigation hands failures to the
    // browser, which saves the error JSON as a file named after the route ("study"); going through
    // fetch lets the page render the actual reason instead.
    async downloadStudyFile(url: string): Promise<void> {
        let res: Response;
        try {
            res = await this.fetch(this.getStudyUrl(url));
        } catch {
            throw new StudyDownloadError("network", "Could not reach the server. Are you online?");
        }

        if (!res.ok) {
            let code = "internal";
            let msg = `The server responded with ${res.status}.`;
            try {
                const body = await res.json();
                if (body?.msg) msg = body.msg;
                if (body?.code) code = body.code;
            } catch {
                // non-json error body (nginx, proxy timeout, …) — keep the status-based message
            }
            throw new StudyDownloadError(code, msg);
        }

        const blob = await res.blob();
        const name = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "document";
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the save in some browsers; give the click a beat.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }

    searchStudyFiles(params: {
        q?: string;
        page?: number;
        pageSize?: number;
        sort?: string;
    }): Promise<StudySearchResponse> {
        const sp = new URLSearchParams();
        if (params.q) sp.set("q", params.q);
        sp.set("page", String(params.page ?? 1));
        sp.set("page_size", String(params.pageSize ?? 20));
        if (params.sort) sp.set("sort", params.sort);
        return this.processResponse(this.fetch("/api/v1/study/search?" + sp.toString()));
    }

    inspectStudyFile(studyId: string): Promise<StudyInspectResponse> {
        return this.processResponse(
            this.fetch("/api/v1/study/inspect?study_id=" + encodeURIComponent(studyId)),
        );
    }

    getGymHistory(
        startDate: string,
        endDate: string,
        aggregation: string = "day",
    ): Promise<{
        data: HistoryDataPoint[];
        aggregation: string;
        startDate: string;
        endDate: string;
        queryMs: number;
    }> {
        return this.processResponse(
            this.fetch(
                `/api/v1/gym/history?start_date=${startDate}&end_date=${endDate}&aggregation=${aggregation}`,
            ),
        );
    }

    getGymMonthly(): Promise<{ data: MonthlyDataPoint[]; queryMs: number }> {
        return this.processResponse(this.fetch("/api/v1/gym/monthly"));
    }

    getGymHourlyPattern(): Promise<HourlyPatternResponse> {
        return this.processResponse(this.fetch("/api/v1/gym/hourly-pattern"));
    }

    getWifiBuildings(): Promise<{ buildings: string[] }> {
        return this.processResponse(this.fetch("/api/v1/wifi/buildings"));
    }

    getWifiBuilding(building: string, hours: number = 24): Promise<WifiBuildingResponse> {
        return this.processResponse(
            this.fetch(
                `/api/v1/wifi/building?building=${encodeURIComponent(building)}&hours=${hours}`,
            ),
        );
    }

    getWifiBuildingPredict(building: string): Promise<WifiBuildingPredictResponse> {
        return this.processResponse(
            this.fetch(`/api/v1/wifi/building_predict?building=${encodeURIComponent(building)}`),
        );
    }
}
