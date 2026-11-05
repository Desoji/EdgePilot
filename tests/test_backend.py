import pytest

from app.main import ema, rsi
from app.backtesting.engine import run_ema_backtest


def make_candles(closes):
    return [
        {
            "timestamp": i * 900,
            "open": float(value),
            "high": float(value) * 1.01,
            "low": float(value) * 0.99,
            "close": float(value),
            "volume": 100.0,
        }
        for i, value in enumerate(closes)
    ]


def test_ema_returns_none_when_history_is_short():
    assert ema([1.0, 2.0], 3) is None


def test_ema_calculates_simple_seed_for_period():
    assert ema([1.0, 2.0, 3.0], 3) == pytest.approx(2.0)


def test_rsi_is_100_for_only_gains():
    assert rsi([float(i) for i in range(20)]) == pytest.approx(100.0)


def test_backtest_rejects_short_history():
    with pytest.raises(ValueError, match="52 candles"):
        run_ema_backtest(make_candles(list(range(1, 30))))


def test_backtest_returns_metrics_and_never_fabricates_trades():
    candles = make_candles([100.0 + i for i in range(100)])
    result = run_ema_backtest(candles)
    assert result["starting_balance"] == 10_000.0
    assert result["trade_count"] == len(result["trades"])
    assert result["max_drawdown_percent"] >= 0
    assert result["assumptions"]["fill_rule"].startswith("Next candle open")
