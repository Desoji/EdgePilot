# EdgePilot

A local educational cryptocurrency market-analysis workspace. This starter release connects a React dashboard to a FastAPI service that reads public spot-market candles and calculates descriptive multi-timeframe indicators.

## Current scope

- React + Vite dashboard
- FastAPI backend
- Public Bybit spot-market kline data (no API key required)
- EMA 20/50, RSI 14, MACD histogram, ATR 14, relative volume and swing-structure context
- 4H / 1H / 15M / 5M confluence view
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

## Next stages

1. Automated tests for indicator calculations and candle normalization
2. Historical storage and robust backtesting
3. A separate paper-only simulator with audit logs and risk limits

No private API keys or account credentials are needed for this version. Never commit secrets to this public repository.
