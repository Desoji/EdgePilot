from __future__ import annotations

from typing import Any


def ema_series(values: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    if period <= 0:
        raise ValueError("period must be positive")
    if len(values) < period:
        return result
    current = sum(values[:period]) / period
    result[period - 1] = current
    alpha = 2 / (period + 1)
    for i in range(period, len(values)):
        current = alpha * values[i] + (1 - alpha) * current
        result[i] = current
    return result


def rsi_value(closes: list[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    recent = changes[-period:]
    gain = sum(max(x, 0.0) for x in recent) / period
    loss = sum(abs(min(x, 0.0)) for x in recent) / period
    if loss == 0:
        return 100.0 if gain else 50.0
    return 100.0 - 100.0 / (1.0 + gain / loss)


def atr_value(candles: list[dict[str, Any]], period: int = 14) -> float | None:
    if len(candles) <= period:
        return None
    ranges = []
    for i in range(1, len(candles)):
        c, prev = candles[i], candles[i - 1]["close"]
        ranges.append(max(c["high"] - c["low"], abs(c["high"] - prev), abs(c["low"] - prev)))
    return sum(ranges[-period:]) / period


def detect_structure(candles: list[dict[str, Any]], left: int = 3, right: int = 3) -> dict[str, Any]:
    """Confirm pivots only after right candles; classify breaks using the last confirmed swing."""
    if left < 1 or right < 1:
        raise ValueError("left and right must be positive")
    highs: list[tuple[int, float]] = []
    lows: list[tuple[int, float]] = []
    for i in range(left, len(candles) - right):
        high = candles[i]["high"]
        low = candles[i]["low"]
        window = candles[i - left:i + right + 1]
        if high >= max(x["high"] for x in window) and sum(x["high"] == high for x in window) == 1:
            highs.append((i, float(high)))
        if low <= min(x["low"] for x in window) and sum(x["low"] == low for x in window) == 1:
            lows.append((i, float(low)))

    last_high = highs[-1] if highs else None
    last_low = lows[-1] if lows else None
    prior_high = highs[-2] if len(highs) > 1 else None
    prior_low = lows[-2] if len(lows) > 1 else None
    trend = "Range"
    if last_high and prior_high and last_low and prior_low:
        hh, hl = last_high[1] > prior_high[1], last_low[1] > prior_low[1]
        lh, ll = last_high[1] < prior_high[1], last_low[1] < prior_low[1]
        if hh and hl:
            trend = "Uptrend"
        elif lh and ll:
            trend = "Downtrend"
        elif hh or hl:
            trend = "Developing bullish"
        elif lh or ll:
            trend = "Developing bearish"

    close = float(candles[-1]["close"]) if candles else 0.0
    previous_close = float(candles[-2]["close"]) if len(candles) > 1 else close
    bos = choch = None
    if last_high and close > last_high[1] and previous_close <= last_high[1]:
        bos = "Bullish"
        if trend in ("Downtrend", "Developing bearish"):
            choch = "Bullish"
    elif last_low and close < last_low[1] and previous_close >= last_low[1]:
        bos = "Bearish"
        if trend in ("Uptrend", "Developing bullish"):
            choch = "Bearish"
    return {
        "trend": trend, "bos": bos, "choch": choch,
        "last_swing_high": last_high[1] if last_high else None,
        "last_swing_low": last_low[1] if last_low else None,
        "confirmed_pivots": len(highs) + len(lows),
    }


def analyse_timeframe(candles: list[dict[str, Any]]) -> dict[str, Any]:
    if len(candles) < 55:
        raise ValueError("At least 55 candles are required for timeframe analysis")
    closes = [float(c["close"]) for c in candles]
    volumes = [float(c["volume"]) for c in candles]
    last = closes[-1]
    e20, e50 = ema_series(closes, 20)[-1], ema_series(closes, 50)[-1]
    rsi, atr = rsi_value(closes), atr_value(candles)
    structure = detect_structure(candles)
    average_volume = sum(volumes[-21:-1]) / 20
    relative_volume = volumes[-1] / average_volume if average_volume > 0 else 0.0

    score = 0.0
    if e20 is not None and e50 is not None:
        score += 30 if last > e20 > e50 else -30 if last < e20 < e50 else 0
    if rsi is not None:
        score += 15 if rsi >= 55 else -15 if rsi <= 45 else 0
    score += {"Uptrend": 20, "Downtrend": -20, "Developing bullish": 10, "Developing bearish": -10}.get(structure["trend"], 0)
    score += 10 if structure["bos"] == "Bullish" else -10 if structure["bos"] == "Bearish" else 0
    if relative_volume >= 1.5:
        score *= 1.05
    score = round(max(-100.0, min(100.0, score)), 1)
    bias = "Bullish" if score >= 25 else "Bearish" if score <= -25 else "Mixed"
    return {
        "bias": bias, "score": score, "ema20": e20, "ema50": e50,
        "rsi": rsi, "atr": atr, "atr_percent": atr / last * 100 if atr is not None and last else None,
        "relative_volume": relative_volume, "structure": structure,
    }


def analyse_hybrid(timeframes: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Weighted descriptive confluence, never a win probability or trade signal."""
    weights = {"4H": 0.30, "1H": 0.30, "15M": 0.25, "5M": 0.15}
    readings: dict[str, Any] = {}
    weighted = total_weight = 0.0
    for label, weight in weights.items():
        candles = timeframes.get(label, [])
        if len(candles) < 55:
            continue
        reading = analyse_timeframe(candles)
        readings[label] = reading
        weighted += reading["score"] * weight
        total_weight += weight
    if total_weight == 0:
        raise ValueError("No timeframe has enough candles for analysis")
    score = round(weighted / total_weight, 1)
    bias = "Bullish" if score >= 25 else "Bearish" if score <= -25 else "Mixed"
    aligned = sum(1 for item in readings.values() if item["bias"] == bias) if bias != "Mixed" else 0
    alignment = round(aligned / len(readings) * 100, 1) if readings else 0.0
    return {
        "bias": bias, "confluence_score": score, "timeframe_alignment_percent": alignment,
        "timeframes": readings,
        "methodology": "Weighted EMA, RSI, confirmed swing structure, BOS and relative-volume context.",
        "interpretation": "Descriptive market context only; score and alignment are not probabilities of success.",
    }
