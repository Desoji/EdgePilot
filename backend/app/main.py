from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.backtesting.engine import run_ema_backtest

BYBIT_URL = "https://api.bybit.com"
VALID_INTERVALS = {"5", "15", "60", "240"}
TIMEFRAMES = [("240", "4H"), ("60", "1H"), ("15", "15M"), ("5", "5M")]
WEIGHTS = {"4H": 0.30, "1H": 0.30, "15M": 0.25, "5M": 0.15}

app = FastAPI(title="EdgePilot API", version="0.1.0",
              description="Educational public market data and multi-timeframe context.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    alpha = 2 / (period + 1)
    current = sum(values[:period]) / period
    for value in values[period:]:
        current = alpha * value + (1 - alpha) * current
    return current


def rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(change, 0.0) for change in changes[-period:]]
    losses = [abs(min(change, 0.0)) for change in changes[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0 if avg_gain else 50.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def atr(candles: list[dict[str, Any]], period: int = 14) -> float | None:
    if len(candles) <= period:
        return None
    true_ranges = []
    for i in range(1, len(candles)):
        candle = candles[i]
        previous_close = candles[i - 1]["close"]
        true_ranges.append(max(
            candle["high"] - candle["low"],
            abs(candle["high"] - previous_close),
            abs(candle["low"] - previous_close),
        ))
    return sum(true_ranges[-period:]) / period


def macd_histogram(values: list[float]) -> float | None:
    if len(values) < 35:
        return None
    fast_line, slow_line = [], []
    for end in range(1, len(values) + 1):
        fast_line.append(ema(values[:end], 12))
        slow_line.append(ema(values[:end], 26))
    line = [f - s for f, s in zip(fast_line, slow_line) if f is not None and s is not None]
    signal = ema(line, 9)
    return line[-1] - signal if len(line) >= 9 and signal is not None else None


def analyse(candles: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]
    last = closes[-1]
    ema20, ema50 = ema(closes, 20), ema(closes, 50)
    rsi_value = rsi(closes)
    atr_value = atr(candles)
    macd_value = macd_histogram(closes)

    recent = candles[-20:]
    previous = candles[-40:-20]
    structure, structure_score = "Range / developing", 0.0
    if len(previous) == 20:
        hh = max(c["high"] for c in recent) > max(c["high"] for c in previous)
        hl = min(c["low"] for c in recent) > min(c["low"] for c in previous)
        lh = max(c["high"] for c in recent) < max(c["high"] for c in previous)
        ll = min(c["low"] for c in recent) < min(c["low"] for c in previous)
        if hh and hl:
            structure, structure_score = "Higher highs / higher lows", 1.0
        elif lh and ll:
            structure, structure_score = "Lower highs / lower lows", -1.0
        elif hh or hl:
            structure, structure_score = "Mixed upward structure", 0.5
        elif lh or ll:
            structure, structure_score = "Mixed downward structure", -0.5

    score = 0.0
    if ema20 is not None and ema50 is not None:
        score += 30 if last > ema20 > ema50 else -30 if last < ema20 < ema50 else 0
    if rsi_value is not None:
        score += 15 if rsi_value > 55 else -15 if rsi_value < 45 else 0
    if macd_value is not None:
        score += 15 if macd_value > 0 else -15 if macd_value < 0 else 0
    score += structure_score * 20

    average_volume = sum(volumes[-21:-1]) / max(len(volumes[-21:-1]), 1)
    volume_ratio = volumes[-1] / average_volume if average_volume else 0.0
    if volume_ratio >= 1.5:
        score *= 1.05
    score = round(max(-100.0, min(100.0, score)), 1)
    bias = "Bullish" if score >= 25 else "Bearish" if score <= -25 else "Mixed"

    return {
        "bias": bias,
        "score": score,
        "rsi": round(rsi_value, 2) if rsi_value is not None else None,
        "rsi_state": "Elevated momentum" if rsi_value is not None and rsi_value >= 70 else
                     "Lower momentum" if rsi_value is not None and rsi_value <= 30 else "Neutral momentum",
        "ema20": round(ema20, 8) if ema20 is not None else None,
        "ema50": round(ema50, 8) if ema50 is not None else None,
        "macd_histogram": round(macd_value, 8) if macd_value is not None else None,
        "atr": round(atr_value, 8) if atr_value is not None else None,
        "atr_percent": round(atr_value / last * 100, 3) if atr_value is not None and last else None,
        "volume_ratio": round(volume_ratio, 2),
        "structure": structure,
    }


async def get_candles(client: httpx.AsyncClient, symbol: str, interval: str,
                      limit: int, category: str = "spot") -> list[dict[str, Any]]:
    try:
        response = await client.get(
            f"{BYBIT_URL}/v5/market/kline",
            params={"category": category, "symbol": symbol, "interval": interval, "limit": limit},
            timeout=15.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Public market-data request failed: {exc}") from exc

    if payload.get("retCode") != 0:
        raise HTTPException(status_code=502, detail=payload.get("retMsg", "Market-data provider error"))

    result = []
    for row in payload.get("result", {}).get("list", []):
        if len(row) < 6:
            continue
        result.append({
            "timestamp": int(row[0]) // 1000,
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        })
    result.sort(key=lambda candle: candle["timestamp"])
    return result


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "EdgePilot API"}


@app.get("/api/market/overview")
async def market_overview(
    symbol: str = Query("BTCUSDT", min_length=5, max_length=20, pattern="^[A-Z0-9]+$"),
    interval: str = Query("15"),
    limit: int = Query(160, ge=60, le=500),
) -> dict[str, Any]:
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail="Interval must be 5, 15, 60 or 240.")
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            get_candles(client, symbol, interval, limit),
            *(get_candles(client, symbol, tf, 160) for tf, _ in TIMEFRAMES),
        )
    requested = results[0]
    if len(requested) < 55:
        raise HTTPException(status_code=502, detail="Insufficient candle history for indicator calculations.")

    tf_context = {}
    combined = 0.0
    for (tf, label), candles in zip(TIMEFRAMES, results[1:]):
        if len(candles) < 55:
            continue
        reading = analyse(candles)
        tf_context[label] = {
            "bias": reading["bias"],
            "score": reading["score"],
            "structure": reading["structure"],
        }
        combined += reading["score"] * WEIGHTS[label]

    latest_reading = analyse(requested)
    combined = round(combined, 1)
    overall_bias = "Bullish" if combined >= 25 else "Bearish" if combined <= -25 else "Mixed"
    recent = requested[-96:]
    return {
        "symbol": symbol,
        "interval": interval,
        "candles": requested,
        "day_high": max(c["high"] for c in recent),
        "day_low": min(c["low"] for c in recent),
        "analysis": {**latest_reading, "bias": overall_bias, "score": combined, "timeframes": tf_context},
        "disclaimer": "Educational market context only. Not a trade signal or probability of success.",
    }


@app.get("/api/backtest")
async def backtest(
    symbol: str = Query("BTCUSDT", min_length=5, max_length=20, pattern="^[A-Z0-9]+$"),
    interval: str = Query("60"),
    limit: int = Query(500, ge=100, le=1000),
    starting_balance: float = Query(10000.0, gt=0, le=100000000),
) -> dict[str, Any]:
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail="Interval must be 5, 15, 60 or 240.")
    async with httpx.AsyncClient() as client:
        candles = await get_candles(client, symbol, interval, limit)
    if len(candles) < 52:
        raise HTTPException(status_code=502, detail="Insufficient candle history for backtesting.")
    try:
        result = run_ema_backtest(candles, starting_balance=starting_balance)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"symbol": symbol, "interval": interval, "candles_tested": len(candles), **result}


@app.get("/api/futures/analysis")
async def futures_analysis(
    symbol: str = Query("BTCUSDT", min_length=5, max_length=20, pattern="^[A-Z0-9]+$"),
    interval: str = Query("15"),
    limit: int = Query(160, ge=60, le=500),
) -> dict[str, Any]:
    """Educational analysis of Bybit linear USDT perpetual public market data."""
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail="Interval must be 5, 15, 60 or 240.")
    async with httpx.AsyncClient() as client:
        candles, timeframe_results, ticker_response = await asyncio.gather(
            get_candles(client, symbol, interval, limit, category="linear"),
            asyncio.gather(*(
                get_candles(client, symbol, tf, 160, category="linear")
                for tf, _ in TIMEFRAMES
            )),
            client.get(
                f"{BYBIT_URL}/v5/market/tickers",
                params={"category": "linear", "symbol": symbol},
                timeout=15.0,
            ),
        )
    if len(candles) < 55:
        raise HTTPException(status_code=502, detail="Insufficient linear futures candle history.")
    try:
        ticker_response.raise_for_status()
        ticker_payload = ticker_response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Futures ticker request failed: {exc}") from exc
    if ticker_payload.get("retCode") != 0:
        raise HTTPException(status_code=502, detail=ticker_payload.get("retMsg", "Futures ticker provider error"))
    ticker_rows = ticker_payload.get("result", {}).get("list", [])
    if not ticker_rows:
        raise HTTPException(status_code=404, detail="No linear futures ticker found for this symbol.")
    ticker = ticker_rows[0]
    timeframe_context = {}
    weighted_score = 0.0
    weight_total = 0.0
    for (tf, label), tf_candles in zip(TIMEFRAMES, timeframe_results):
        if len(tf_candles) < 55:
            continue
        tf_reading = analyse(tf_candles)
        timeframe_context[label] = {
            "bias": tf_reading["bias"],
            "score": tf_reading["score"],
            "structure": tf_reading["structure"],
        }
        weighted_score += tf_reading["score"] * WEIGHTS[label]
        weight_total += WEIGHTS[label]
    reading = analyse(candles)
    weighted_score = round(weighted_score / weight_total, 1) if weight_total else 0.0
    bias = "Bullish" if weighted_score >= 25 else "Bearish" if weighted_score <= -25 else "Mixed"

    def optional_float(key: str) -> float | None:
        value = ticker.get(key)
        try:
            return float(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            return None

    recent = candles[-96:]
    return {
        "symbol": symbol,
        "category": "linear",
        "interval": interval,
        "candles": candles,
        "day_high": max(c["high"] for c in recent),
        "day_low": min(c["low"] for c in recent),
        "analysis": {**reading, "bias": bias, "score": weighted_score, "timeframes": timeframe_context},
        "derivatives": {
            "mark_price": optional_float("markPrice"),
            "index_price": optional_float("indexPrice"),
            "funding_rate": optional_float("fundingRate"),
            "open_interest": optional_float("openInterest"),
            "next_funding_time": ticker.get("nextFundingTime"),
        },
        "data_source": "Bybit public linear USDT perpetual market data",
        "disclaimer": "Educational market context only. Funding and open interest are contextual metrics, not directional trade instructions. No leverage or order execution is provided.",
    }


from app.analysis.hybrid import analyse_hybrid


@app.get("/api/market/hybrid")
async def hybrid_market_analysis(
    symbol: str = Query("BTCUSDT", min_length=5, max_length=20, pattern="^[A-Z0-9]+$"),
) -> dict[str, Any]:
    """Return descriptive hybrid analysis from 4H, 1H, 15M and 5M public spot candles."""
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *(get_candles(client, symbol, interval, 200) for interval, _ in TIMEFRAMES)
        )
    timeframe_data: dict[str, list[dict[str, Any]]] = {}
    for (_, label), candles in zip(TIMEFRAMES, results):
        if len(candles) >= 55:
            timeframe_data[label] = candles
    try:
        analysis = analyse_hybrid(timeframe_data)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "symbol": symbol,
        "analysis": analysis,
        "data_source": "Bybit public spot market data",
        "disclaimer": "Educational market context only. Not financial advice, a trade instruction, or a probability of success.",
    }
