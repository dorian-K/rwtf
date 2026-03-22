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

export type PredictionMethod = "closest" | "average";

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

    getGymInterpLine(dayoffset: number, method: PredictionMethod = "closest"): Promise<GymInterpLineResponse> {
        return this.processResponse(this.fetch("/api/v1/gym_interpline?dayoffset=" + dayoffset + "&method=" + method));
    }

    isAachener(): Promise<boolean> {
        return this.processResponse(this.fetch("/api/v1/is_aachen")).then(
            (data: any) => data.status,
        );
    }

    getStudyUrl(url: string): string {
        return `/api/v1/study?url=${url}`;
    }
}
