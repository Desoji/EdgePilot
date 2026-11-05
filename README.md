# EdgePilot

A local educational cryptocurrency market-analysis workspace. This starter release connects a React dashboard to a FastAPI service that reads public spot-market candles and calculates descriptive multi-timeframe indicators.

## Current scope

- React + Vite dashboard
- FastAPI backend
- Public Bybit spot-market kline data (no API key required)
- EMA 20/50, RSI 14, MACD histogram, ATR 14, relative volume, confirmed swing pivots, BOS / CHoCH context
- 4H / 1H / 15M / 5M confluence view
- Dedicated USDT linear perpetual futures analysis page with public funding-rate, mark/index-price and open-interest context
- Local-first operation

**Important:** EdgePilot is an educational research tool, not financial advice. Its confluence score is not a probability or a guaranteed win rate. This project does not connect to private account endpoints or place real-money orders.

## Requirements

- Python 3.11+
- Node.js LTS

## Run the backend (PowerShell)

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, run:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Health check: http://127.0.0.1:8000/api/health

## Run the frontend

Open a second PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The frontend expects the backend at http://127.0.0.1:8000. To override it, create `frontend/.env.local`:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Data notes

The backend calls Bybit's public `GET /v5/market/kline` endpoint for spot candles. The provider returns newest candles first; EdgePilot sorts them oldest-to-newest. The latest candle may still be forming and its values can change until the interval closes.

## Backtesting (first research version)

The API includes `GET /api/backtest?symbol=BTCUSDT&interval=60&limit=500`. It tests a simple long-only EMA 20/50 crossover on public historical candles. Signals are evaluated at candle close and simulated fills occur at the next candle open. The model includes configurable code-level fee and slippage assumptions (defaults: 0.10% and 0.05% per side), compounds a fully allocated simulated balance, and reports win rate, profit factor and maximum drawdown. An open position at the end is not force-closed. This is a baseline for validating the backtesting pipeline, not the final hybrid strategy.

Run backend tests from the `backend` folder after installing requirements:

```powershell
pip install -r requirements.txt
$env:PYTHONPATH = "."
pytest ../tests -q
```

## Futures analysis endpoint

The dashboard includes a Futures Analysis page backed by `GET /api/futures/analysis?symbol=BTCUSDT&interval=15`. It uses Bybit public linear (USDT perpetual) candles and ticker data. The browser also subscribes to Bybit's public linear WebSocket for live ticker, order-book, recent-trade and selected-timeframe kline updates. The page displays mark/index price, funding, open interest, indicator readings and weighted multi-timeframe context. The position monitor is a paper-mode placeholder. No account credentials, leverage controls or real order execution are supported.



### Live futures feed

The Futures page opens a public WebSocket connection to `wss://stream.bybit.com/v5/public/linear` and subscribes to the selected contract's ticker, order book, public trades and kline stream. It reconnects after a dropped connection and clears/re-subscribes when the contract or interval changes. This is public read-only market data; the position panel does not represent exchange positions.



### Paper position manager

The Futures page includes a browser-local paper position manager. It supports simulated long/short entries at the currently displayed public price, quantity, optional stop-loss and take-profit levels, automatic simulated exits when the live price reaches those levels, manual simulated closes, unrealised/realised P&L and a recent closed-position history. Open positions and history are stored in the browser's local storage. P&L is simplified and excludes fees, funding, slippage and liquidation mechanics. No exchange order is submitted and no account credentials are used.

## Hybrid analysis endpoint

The research API also exposes GET /api/market/hybrid?symbol=BTCUSDT. It retrieves 4H, 1H, 15M and 5M candles and returns weighted descriptive context using EMA alignment, RSI, confirmed swing pivots, basic trend classification, break-of-structure context and relative volume. Pivots are only considered after the configured right-side confirmation candles have elapsed. The score is not a probability, prediction guarantee or instruction to trade.

Run the hybrid-analysis unit tests from the backend folder:

```powershell
$env:PYTHONPATH = "."
pytest tests -q
```

## Next stages

1. Compare hybrid strategy results with the EMA baseline using walk-forward and out-of-sample tests
2. Add historical storage and more realistic execution assumptions
3. Build a separate paper-only simulator with audit logs, simulated position sizing and hard risk limits

No private API keys or account credentials are needed for this version. Never commit secrets to this public repository.
