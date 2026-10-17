"""Internal HTTP sidecar serving Timestral forecasts to the Node API (never exposed via nginx).

POST /forecast  {"context": [number | null, ...], "prediction_length": int, "quantiles": [0.5, ...]}
             -> {"quantiles": {"0.5": [...], ...}}   one list of prediction_length values per level
GET  /health    -> {"ok": true, "model": "..."}

`null` in the context marks a missing sample (e.g. the gym is closed overnight). One forecast at a
time: the model is CPU-bound, so concurrent requests would only slow each other down.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from timestral import TimestralForecaster

MODEL = os.environ.get("TIMESTRAL_MODEL", "mistralai/Timestral-209M")
PORT = int(os.environ.get("PORT", "8000"))
MAX_CONTEXT = 32_768  # the model's context limit
MAX_HORIZON = 4_096  # a week at 5-min steps is 2,016; anything far beyond is a caller bug
MAX_BODY = 2_000_000

model = TimestralForecaster.from_pretrained(MODEL, device="cpu")
lock = threading.Lock()
print(f"loaded {MODEL}, listening on :{PORT}", flush=True)


def forecast(body: dict) -> dict:
    ctx = np.array([np.nan if v is None else float(v) for v in body["context"]], dtype=np.float32)
    horizon = int(body["prediction_length"])
    levels = [float(q) for q in body.get("quantiles", [0.5])]
    if not 1 <= len(ctx) <= MAX_CONTEXT or not 1 <= horizon <= MAX_HORIZON:
        raise ValueError("context or prediction_length out of range")
    if np.isnan(ctx).all():
        raise ValueError("context has no observed values")
    with lock, torch.inference_mode():
        fc = model.forecast(ctx, prediction_length=horizon)
    return {"quantiles": {str(q): fc.quantile(q)[0, 0].tolist() for q in levels}}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"ok": True, "model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/forecast":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            self._send(413, {"error": "body too large or empty"})
            return
        try:
            self._send(200, forecast(json.loads(self.rfile.read(length))))
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, fmt: str, *args) -> None:
        pass  # the Node side logs failures; per-request access logs would just be noise


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
