from __future__ import annotations

import math

import pytest

from app.analysis.hybrid import analyse_hybrid, analyse_timeframe, detect_structure, ema_series, rsi_value


def make_candles(count: int = 140, trend: float = 0.8) -> list[dict]:
    candles = []
    price = 100.0
    for i in range(count):
        previous = price
        price += trend + math.sin(i / 3) * 0.25
        candles.append({
            "timestamp": i * 60,
            "open": previous,
            "high": max(previous, price) + 0.5,
            "low": min(previous, price) - 0.5,
            "close": price,
            "volume": 1000.0 + (100.0 if i % 7 == 0 else 0.0),
        })
    return candles


def test_ema_returns_none_until_period_is_available():
    values = ema_series([1.0, 2.0, 3.0, 4.0], 3)
    assert values[:2] == [None, None]
    assert values[2] == pytest.approx(2.0)
    assert values[3] is not None


def test_rsi_is_bounded_and_detects_monotonic_gain():
    value = rsi_value([float(x) for x in range(20)])
    assert value == pytest.approx(100.0)


def test_structure_has_confirmed_swing_fields():
    result = detect_structure(make_candles())
    assert "trend" in result
    assert "last_swing_high" in result
    assert "last_swing_low" in result
    assert result["confirmed_pivots"] >= 0


def test_timeframe_analysis_requires_enough_history():
    with pytest.raises(ValueError):
        analyse_timeframe(make_candles(30))


def test_hybrid_analysis_reports_weighted_timeframe_context():
    data = {label: make_candles(140, trend=0.8) for label in ("4H", "1H", "15M", "5M")}
    result = analyse_hybrid(data)
    assert result["bias"] in {"Bullish", "Bearish", "Mixed"}
    assert -100 <= result["confluence_score"] <= 100
    assert result["timeframe_alignment_percent"] == 100
    assert set(result["timeframes"]) == {"4H", "1H", "15M", "5M"}
    assert "not probabilities" in result["interpretation"]


def test_hybrid_analysis_rejects_empty_timeframes():
    with pytest.raises(ValueError):
        analyse_hybrid({})
