"""Score Mistral's Timestral zero-shot forecaster against the live predictor on the same backtest grid.

`server/test/sweep.ts` (run with DUMP=path) writes every point it scores: the day, the "now" cutoff,
the target time of day, the eventual actual, and the live predictor's line + bands. This script
re-forecasts each (day, cutoff) with Timestral from the raw gym history strictly before the cutoff,
and scores it on exactly those target points, so both numbers are directly comparable.

    TZ=Europe/Berlin DB_HOST=127.0.0.1 DUMP=/tmp/cases.jsonl node dist/test/sweep.js
    python -m ai.timestral_eval --dump /tmp/cases.jsonl --csv ai/data/out.csv --model 28M

Needs `pip install git+https://github.com/mistralai/timestral.git pandas`.
"""

import argparse
import json
import time
from collections import defaultdict

import numpy as np
import pandas as pd
import torch

TZ = "Europe/Berlin"
STEP_MIN = 5  # the crawler samples every 5 minutes
STEP_MS = STEP_MIN * 60_000
MAX_GAP_MS = 15 * 60_000  # grid points further than this from a real sample are left missing


def load_series(csv_path: str) -> tuple[np.ndarray, np.ndarray]:
    """Raw gym samples as (epoch-ms, value), sorted; same CSV layout as `ai/data.py` reads."""
    df = pd.read_csv(csv_path, header=None, names=["id", "value", "time"])
    t = pd.to_datetime(df["time"]).dt.tz_localize(TZ, ambiguous="NaT", nonexistent="NaT")
    # Explicit unit: pandas 3 infers the resolution (often seconds), so a bare int cast is ambiguous.
    df, t = df[t.notna()], t[t.notna()]
    df = df.assign(ms=t.dt.as_unit("ms").astype("int64"))
    df = df.sort_values("ms")
    return df["ms"].to_numpy(np.int64), df["value"].to_numpy(np.float64)


def context_grid(ms: np.ndarray, vals: np.ndarray, cutoff: int, steps: int) -> np.ndarray:
    """`steps` values on the 5-min grid ending at `cutoff`, linearly interpolated from samples
    strictly before the cutoff (no leakage); NaN where the nearest sample is too far away."""
    grid = cutoff - STEP_MS * np.arange(steps - 1, -1, -1, dtype=np.int64)
    end = np.searchsorted(ms, cutoff, side="left")  # samples at/after the cutoff are unseen
    m, v = ms[:end], vals[:end]
    out = np.interp(grid, m, v)
    idx = np.clip(np.searchsorted(m, grid), 1, len(m) - 1)
    gap = np.minimum(np.abs(m[idx] - grid), np.abs(grid - m[idx - 1]))
    out[gap > MAX_GAP_MS] = np.nan
    out[grid > m[-1] + MAX_GAP_MS] = np.nan
    return out


def known_covariates(cutoff: int, steps: int, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Calendar covariates over context + horizon: numeric time-of-day (sin/cos) and categorical
    weekday. Both are known in advance, so they are legal inputs for the forecast window too."""
    t = cutoff + STEP_MS * np.arange(-(steps - 1), horizon + 1, dtype=np.int64)
    local = pd.to_datetime(t, unit="ms", utc=True).tz_convert(TZ)
    frac = (local.hour * 60 + local.minute).to_numpy() / 1440.0
    numeric = np.stack([np.sin(2 * np.pi * frac), np.cos(2 * np.pi * frac)])
    weekday = local.weekday.to_numpy(np.float64)[None, :]
    return numeric, weekday


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True, help="JSONL written by sweep.ts with DUMP=")
    ap.add_argument("--csv", required=True, help="rwth_gym export (id,value,time)")
    ap.add_argument("--model", default="28M", help="5M | 28M | 123M | 209M")
    ap.add_argument("--context-days", type=float, default=28, help="history fed to the model")
    ap.add_argument("--covariates", action="store_true", help="add time-of-day + weekday inputs")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--limit", type=int, default=0, help="only the first N cutoffs (quick runs)")
    args = ap.parse_args()

    from timestral import TimestralForecaster

    model = TimestralForecaster.from_pretrained(
        f"mistralai/Timestral-{args.model}", device="cuda" if torch.cuda.is_available() else "cpu"
    )
    if args.covariates and not model.supports_known_covariates:
        raise SystemExit(f"Timestral-{args.model} cannot take known-future covariates")

    cases: dict[int, list[dict]] = defaultdict(list)
    with open(args.dump) as f:
        for line in f:
            if line.strip():
                r = json.loads(line)
                cases[r["cutoff"]].append(r)
    cutoffs = sorted(cases)
    if args.limit:
        cutoffs = cutoffs[: args.limit]

    ms, vals = load_series(args.csv)
    steps = int(args.context_days * 1440 / STEP_MIN)

    # Batch cutoffs that share a horizon (same wall-clock hour => same steps to midnight).
    def horizon_of(c: int) -> int:
        target_max = max(c + (r["t"] - _tod(c)) * 60_000 for r in cases[c])
        return int(np.ceil((target_max - c) / STEP_MS))

    by_h: dict[int, list[int]] = defaultdict(list)
    for c in cutoffs:
        by_h[horizon_of(c)].append(c)

    levels = None
    rows = []  # (actual, baseline record, quantiles at the target)
    t0 = time.time()
    for h, group in sorted(by_h.items()):
        for i in range(0, len(group), args.batch):
            batch = group[i : i + args.batch]
            ctx = np.stack([context_grid(ms, vals, c, steps) for c in batch])
            kw = {}
            if args.covariates:
                cov = [known_covariates(c, steps, h) for c in batch]
                kw["known_covariates"] = np.stack([n for n, _ in cov])
                kw["categorical_known_covariates"] = np.stack([w for _, w in cov])
            fc = model.forecast(ctx, prediction_length=h, **kw)
            q = fc.quantiles[:, 0].cpu().numpy()  # (B, H, Q)
            levels = np.asarray(fc.quantile_levels)
            for b, c in enumerate(batch):
                # Forecast step k is the grid point cutoff + (k+1)*5min; interpolate to the target.
                fx = c + STEP_MS * np.arange(1, h + 1)
                for r in cases[c]:
                    target = c + (r["t"] - _tod(c)) * 60_000
                    qt = np.array([np.interp(target, fx, q[b, :, j]) for j in range(q.shape[-1])])
                    rows.append((r, qt))
        print(f"  horizon {h:3d} steps: {len(group)} cutoffs done ({time.time() - t0:.0f}s)")

    report(rows, levels, args)


def _tod(ms: int) -> int:
    d = pd.Timestamp(ms, unit="ms", tz="UTC").tz_convert(TZ)
    return d.hour * 60 + d.minute


def report(rows: list, levels: np.ndarray, args) -> None:
    a = np.array([r["actual"] for r, _ in rows])
    Q = np.stack([q for _, q in rows])
    lv = list(np.round(levels, 2))
    qi = lambda p: Q[:, lv.index(p)]  # noqa: E731

    def pinball(q: np.ndarray, p: float) -> float:
        d = a - q
        return float(np.mean(np.maximum(p * d, (p - 1) * d)))

    base = {k: np.array([r[k] for r, _ in rows]) for k in ("pred", "lower", "upper", "lowerWide", "upperWide")}
    cov = lambda lo, hi: 100 * np.mean((a >= lo) & (a <= hi))  # noqa: E731
    width = lambda lo, hi: float(np.mean(hi - lo))  # noqa: E731

    tag = f"Timestral-{args.model}{' +cov' if args.covariates else ''} ctx={args.context_days:g}d"
    print(f"\n{len(rows)} scored points, {len({r['cutoff'] for r, _ in rows})} cutoffs\n")
    print(f"{'':28s}{'MAE':>8s}{'cov50':>8s}{'w50':>7s}{'cov-outer':>11s}{'w-outer':>9s}")
    print(f"{'current predictor':28s}{np.mean(np.abs(base['pred'] - a)):8.3f}"
          f"{cov(base['lower'], base['upper']):7.1f}%{width(base['lower'], base['upper']):7.1f}"
          f"{cov(base['lowerWide'], base['upperWide']):10.1f}%{width(base['lowerWide'], base['upperWide']):9.1f}")
    for lo, hi in ((0.05, 0.95), (0.01, 0.99)):
        print(f"{tag + f' [{lo}-{hi}]':28s}{np.mean(np.abs(qi(0.5) - a)):8.3f}"
              f"{cov(qi(0.25), qi(0.75)):7.1f}%{width(qi(0.25), qi(0.75)):7.1f}"
              f"{cov(qi(lo), qi(hi)):10.1f}%{width(qi(lo), qi(hi)):9.1f}")

    # Pinball loss at the quantiles both methods have (the live predictor's median line is a
    # weighted mean, but it is what the UI shows as the central estimate).
    print("\npinball loss      q=0.25   q=0.50   q=0.75")
    print(f"current        {pinball(base['lower'], .25):8.3f} {pinball(base['pred'], .5):8.3f} "
          f"{pinball(base['upper'], .75):8.3f}")
    print(f"timestral      {pinball(qi(.25), .25):8.3f} {pinball(qi(.5), .5):8.3f} {pinball(qi(.75), .75):8.3f}")

    print("\nMAE by cutoff hour   current  timestral")
    hours = np.array([_tod(r["cutoff"]) // 60 for r, _ in rows])
    for h in sorted(set(hours)):
        m = hours == h
        print(f"  {h:02d}:00            {np.mean(np.abs(base['pred'][m] - a[m])):8.3f} "
              f"{np.mean(np.abs(qi(0.5)[m] - a[m])):9.3f}")


if __name__ == "__main__":
    main()
