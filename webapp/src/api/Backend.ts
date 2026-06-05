export interface GymDataPiece {
    auslastung: number;
    created_at: string;
}

export interface GymResponse {
    data_today: GymDataPiece[];
    data_historic: GymDataPiece[][];
}

export interface GymInterpLineResponse {
    interpLine: GymDataPiece[];
    allTimeHigh: number;
    method?: string;
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

export type PredictionMethod = "closest" | "average" | "median" | "dayofweek";

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
}

export interface WifiBuildingPredictResponse {
    building: string;
    dataToday: WifiSeriesPoint[];
    interpLine: WifiSeriesPoint[];
    method: PredictionMethod;
    dayoffset: number;
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
        method: PredictionMethod = "closest",
    ): Promise<GymInterpLineResponse> {
        return this.processResponse(
            this.fetch("/api/v1/gym_interpline?dayoffset=" + dayoffset + "&method=" + method),
        );
    }

    isAachener(): Promise<boolean> {
        return this.processResponse(this.fetch("/api/v1/is_aachen")).then(
            (data: any) => data.status,
        );
    }

    getStudyUrl(url: string): string {
        return `/api/v1/study?url=${url}`;
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

    getWifiBuildingPredict(
        building: string,
        method: PredictionMethod = "closest",
    ): Promise<WifiBuildingPredictResponse> {
        return this.processResponse(
            this.fetch(
                `/api/v1/wifi/building_predict?building=${encodeURIComponent(building)}&method=${method}`,
            ),
        );
    }
}
