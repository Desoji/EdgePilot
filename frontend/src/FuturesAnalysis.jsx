import { useCallback, useEffect, useMemo, useState } from 'react'
import './FuturesAnalysis.css'

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
const intervals = [{ label: '5m', value: '5' }, { label: '15m', value: '15' }, { label: '1H', value: '60' }, { label: '4H', value: '240' }]
const fmt = (value, digits = 2) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const signed = (value, digits = 2) => value == null ? '—' : (Number(value) > 0 ? '+' : '') + fmt(value, digits)

function FuturesChart({ candles }) {
  const points = useMemo(() => {
    if (!candles?.length) return ''
    const values = candles.map(c => c.close)
    const low = Math.min(...values)
    const range = Math.max(...values) - low || 1
    return values.map((v, i) => (8 + i / Math.max(values.length - 1, 1) * 984) + ',' + (166 - (v - low) / range * 146)).join(' ')
  }, [candles])
  if (!points) return <div className="chart-empty">Waiting for futures data…</div>
  return <svg className="price-chart" viewBox="0 0 1000 190" role="img" aria-label="Linear perpetual recent closing prices">
    {[42, 86, 130, 174].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="chart-grid" />)}
    <polyline points={points} className="chart-line futures-chart-line" />
  </svg>
}

function FuturesMetric({ label, value, detail }) {
  return <article className="metric-card"><span className="eyebrow">{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

export default function FuturesAnalysis() {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('15')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ symbol, interval, limit: '160' })
      const response = await fetch(API + '/api/futures/analysis?' + query)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || 'Futures market service returned ' + response.status)
      }
      setData(await response.json())
      setUpdated(new Date())
    } catch (err) {
      setError(err.message || 'Could not connect to EdgePilot backend.')
    } finally {
      setLoading(false)
    }
  }, [symbol, interval])

  useEffect(() => { refresh() }, [refresh])

  const candles = data?.candles || []
  const latest = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const change = latest && previous ? (latest.close - previous.close) / previous.close * 100 : null
  const analysis = data?.analysis
  const derivatives = data?.derivatives || {}
  const biasClass = analysis?.bias === 'Bullish' ? 'positive' : analysis?.bias === 'Bearish' ? 'negative' : ''

  return <div className="futures-page">
    <header className="topbar">
      <div><div className="breadcrumb">Workspace <span>/</span> Futures</div><h1>Futures analysis</h1></div>
      <div className="topbar-right"><span className="data-pill"><i /> Public derivatives data</span><button className="refresh-button" onClick={refresh} disabled={loading}><span>{loading ? '◌' : '↻'}</span> Refresh</button></div>
    </header>

    <div className="notice"><b>i</b><p><strong>Research environment.</strong> This page reads public Bybit USDT perpetual data. It does not connect to a trading account, recommend leverage, or place orders. Funding and open interest are context metrics, not predictions.</p></div>

    <section className="market-toolbar">
      <label className="asset-picker"><span>PERPETUAL CONTRACT</span><select value={symbol} onChange={e => setSymbol(e.target.value)}>{symbols.map(s => <option key={s} value={s}>{s.replace('USDT', '')} / USDT</option>)}</select></label>
      <div className="interval-picker">{intervals.map(item => <button key={item.value} className={interval === item.value ? 'interval active' : 'interval'} onClick={() => setInterval(item.value)}>{item.label}</button>)}</div>
      <span className="market-source">CONTRACT <b>USDT LINEAR · PERPETUAL</b></span>
    </section>

    {error && <div className="error-panel"><strong>Could not load futures data</strong><span>{error}</span><small>Confirm the backend is running at {API} and the symbol is supported by Bybit linear markets.</small></div>}

    <section className="price-heading">
      <div><span className="eyebrow">LINEAR PERPETUAL · {symbol}</span><div className="price-line"><strong>{latest ? fmt(latest.close, latest.close < 1 ? 5 : 2) : '—'}</strong><span className="currency">USDT</span>{change != null && <span className={'change ' + (change >= 0 ? 'positive' : 'negative')}>{signed(change)}%</span>}</div></div>
      <span className="updated-label">{updated ? 'Updated ' + updated.toLocaleTimeString() : 'Awaiting connection'}</span>
    </section>

    <section className="chart-panel">
      <div className="panel-heading"><div><h2>Perpetual price movement</h2><p>Recent closing prices · {intervals.find(x => x.value === interval)?.label}</p></div><span className="live-label"><i /> {loading ? 'UPDATING' : 'CONNECTED'}</span></div>
      <div className="chart-wrap">{loading && !candles.length ? <div className="chart-empty">Loading futures market data…</div> : <FuturesChart candles={candles} />}</div>
      <div className="chart-footer"><span>{candles.length ? new Date(candles[0].timestamp * 1000).toLocaleString() : '—'}</span><span>{latest ? new Date(latest.timestamp * 1000).toLocaleString() : '—'}</span></div>
    </section>

    <section className="metrics-grid futures-metrics">
      <FuturesMetric label="MARK PRICE" value={fmt(derivatives.mark_price, 2)} detail="Exchange-reported mark price · USDT" />
      <FuturesMetric label="INDEX PRICE" value={fmt(derivatives.index_price, 2)} detail="Underlying index reference · USDT" />
      <FuturesMetric label="FUNDING RATE" value={derivatives.funding_rate == null ? '—' : signed(derivatives.funding_rate * 100, 4) + '%'} detail="Current rate · next settlement is exchange-defined" />
      <FuturesMetric label="OPEN INTEREST" value={derivatives.open_interest == null ? '—' : fmt(derivatives.open_interest, 2)} detail="Displayed in contract units by provider" />
    </section>

    <section className="analysis-section">
      <div className="section-title"><div><span className="eyebrow">MULTI-TIMEFRAME ENGINE</span><h2>Futures market context</h2></div><span className="muted-tag">Descriptive only · Not a trade signal</span></div>
      <div className="analysis-grid">
        <article className="bias-card"><span className="eyebrow">WEIGHTED MARKET BIAS</span><strong className={biasClass}>{analysis?.bias || '—'}</strong><div className="score-track"><span className={biasClass} style={{ width: Math.min(100, Math.abs(analysis?.score || 0)) + '%' }} /></div><div className="score-caption"><span>Confluence score</span><b>{analysis ? signed(analysis.score, 0) + '/100' : '—'}</b></div><p>Weighted context from 4H, 1H, 15M and 5M linear-contract candles. This score is not a win probability or a forecast.</p></article>
        <article className="timeframe-card"><div className="card-title-row"><h3>Timeframe alignment</h3><span className="tiny-tag">EMA + momentum + structure</span></div>{['4H', '1H', '15M', '5M'].map(label => { const item = analysis?.timeframes?.[label]; return <div className="timeframe-row" key={label}><span>{label}</span><div className="timeframe-bar"><i className={item?.bias === 'Bullish' ? 'positive-bg' : item?.bias === 'Bearish' ? 'negative-bg' : ''} style={{ width: Math.abs(item?.score || 0) + '%' }} /></div><b className={item?.bias === 'Bullish' ? 'positive' : item?.bias === 'Bearish' ? 'negative' : ''}>{item?.bias || '—'}</b></div> })}</article>
        <article className="detail-card"><div className="card-title-row"><h3>Indicator readings</h3><span className="tiny-tag">Selected interval</span></div><div className="detail-row"><span>EMA 20</span><b>{analysis ? fmt(analysis.ema20) : '—'}</b></div><div className="detail-row"><span>EMA 50</span><b>{analysis ? fmt(analysis.ema50) : '—'}</b></div><div className="detail-row"><span>RSI 14</span><b>{analysis ? fmt(analysis.rsi, 1) : '—'}</b></div><div className="detail-row"><span>ATR</span><b>{analysis ? fmt(analysis.atr_percent, 2) + '%' : '—'}</b></div><div className="detail-row"><span>Structure</span><b>{analysis?.structure || '—'}</b></div><div className="detail-row"><span>Relative volume</span><b>{analysis ? fmt(analysis.volume_ratio, 2) + '×' : '—'}</b></div></article>
      </div>
    </section>

    <section className="futures-explainer">
      <div><span className="eyebrow">DERIVATIVES CONTEXT</span><h2>Read the contract, not just the chart.</h2><p>Funding rates describe periodic payments between perpetual-contract participants. Open interest describes the number of outstanding contracts. Neither metric independently tells you which direction price will move. Consider them alongside price structure, volatility and historical validation.</p></div>
      <div className="futures-tags"><span>Linear USDT perpetual</span><span>Funding rate</span><span>Open interest</span><span>Mark / index price</span><span>EMA 20 / 50</span><span>RSI 14</span><span>ATR 14</span></div>
    </section>
    <footer className="footer"><span>EDGE PILOT © 2026</span><span>Futures research · Public market data only</span></footer>
  </div>
}
