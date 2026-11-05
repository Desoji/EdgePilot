from __future__ import annotations

from typing import Any


def _ema_series(values: list[float], period: int) -> list[float | None]:
    output: list[float | None] = [None] * len(values)
    if len(values) < period:
        return output
    current = sum(values[:period]) / period
    output[period - 1] = current
    alpha = 2 / (period + 1)
    for index in range(period, len(values)):
        current = alpha * values[index] + (1 - alpha) * current
        output[index] = current
    return output


def run_ema_backtest(
    candles: list[dict[str, Any]],
    starting_balance: float = 10_000.0,
    fee_rate: float = 0.001,
    slippage_rate: float = 0.0005,
) -> dict[str, Any]:
    """Long-only EMA crossover simulation. Signals use candle close; fills use next open."""
    if starting_balance <= 0:
        raise ValueError("starting_balance must be greater than zero")
    if fee_rate < 0 or slippage_rate < 0:
        raise ValueError("fee_rate and slippage_rate cannot be negative")
    if len(candles) < 52:
        raise ValueError("At least 52 candles are required")

    closes = [float(c["close"]) for c in candles]
    fast = _ema_series(closes, 20)
    slow = _ema_series(closes, 50)
    balance = float(starting_balance)
    equity_curve = [balance]
    trades: list[dict[str, Any]] = []
    entry: dict[str, Any] | None = None

    for index in range(1, len(candles) - 1):
        previous_ready = fast[index - 1] is not None and slow[index - 1] is not None
        current_ready = fast[index] is not None and slow[index] is not None
        if not (previous_ready and current_ready):
            equity_curve.append(balance)
            continue

        crossed_up = fast[index - 1] <= slow[index - 1] and fast[index] > slow[index]
        crossed_down = fast[index - 1] >= slow[index - 1] and fast[index] < slow[index]
        next_candle = candles[index + 1]

        if entry is None and crossed_up:
            fill = float(next_candle["open"]) * (1 + slippage_rate)
            entry = {"timestamp": int(next_candle["timestamp"]), "price": fill}
        elif entry is not None and crossed_down:
            exit_price = float(next_candle["open"]) * (1 - slippage_rate)
            gross_return = exit_price / entry["price"] - 1
            net_return = (1 + gross_return) * (1 - fee_rate) ** 2 - 1
            before = balance
            balance *= 1 + net_return
            trades.append({
                "entry_timestamp": entry["timestamp"],
                "exit_timestamp": int(next_candle["timestamp"]),
                "entry_price": round(entry["price"], 8),
                "exit_price": round(exit_price, 8),
                "return_percent": round(net_return * 100, 4),
                "pnl": round(balance - before, 2),
                "result": "Win" if net_return > 0 else "Loss" if net_return < 0 else "Flat",
            })
            entry = None
        equity_curve.append(balance)

    peak = equity_curve[0]
    max_drawdown = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        if peak:
            max_drawdown = max(max_drawdown, (peak - value) / peak)

    wins = sum(1 for trade in trades if trade["result"] == "Win")
    losses = sum(1 for trade in trades if trade["result"] == "Loss")
    total = len(trades)
    net_profit = balance - starting_balance
    gross_wins = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    gross_losses = abs(sum(t["pnl"] for t in trades if t["pnl"] < 0))

    return {
        "strategy": "EMA 20/50 crossover · long-only",
        "starting_balance": round(starting_balance, 2),
        "ending_balance": round(balance, 2),
        "net_profit": round(net_profit, 2),
        "return_percent": round(net_profit / starting_balance * 100, 3),
        "trade_count": total,
        "wins": wins,
        "losses": losses,
        "win_rate_percent": round(wins / total * 100, 2) if total else None,
        "profit_factor": round(gross_wins / gross_losses, 3) if gross_losses else (None if not gross_wins else "inf"),
        "max_drawdown_percent": round(max_drawdown * 100, 3),
        "open_position_at_end": entry is not None,
        "assumptions": {
            "fee_per_side_percent": fee_rate * 100,
            "slippage_per_side_percent": slippage_rate * 100,
            "fill_rule": "Next candle open after confirmed crossover",
            "position_sizing": "100% of simulated balance per position",
        },
        "trades": trades[-50:],
        "disclaimer": "Illustrative historical simulation, not a forecast or probability of future success.",
    }
