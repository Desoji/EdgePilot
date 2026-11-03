import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
const intervals = [{ label: '5m', value: '5' }, { label: '15m', value: '15' }, { label: '1H', value: '60' }, { label: '4H', value: '240' }]

const fmt = (value, digits = 2) => value == null ? '—' : Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (value, digits = 2) => value == null ? '—' : (value > 0 ? '+' : '') + fmt(value, digits)

function PriceChart({ candles }) {
  const points = useMemo(() => {
    if (!candles?.length) return ''
    const values = candles.map((c) => c.close)
    const low = Math.min(...values)
    const range = Math.max(...values) - low || 1
    return values.map((value, i) => (8 + i / Math.max(values.length - 1, 1) * 984) + ',' + (166 - (value - low) / range * 146)).join(' ')
  }, [candles])
  if (!points) return <div className="chart-empty">Waiting for market data…</div>
  return <svg className="price-chart" viewBox="0 0 1000 190" role="img" aria-label="Recent closing prices">
    <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9a8cff" stopOpacity=".25" /><stop offset="100%" stopColor="#9a8cff" stopOpacity="0" /></linearGradient></defs>
    {[42, 86, 130, 174].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="chart-grid" />)}
    <polyline points={'8,190 ' + points + ' 992,190'} fill="url(#fill)" />
    <polyline points={points} className="chart-line" />
  </svg>
}

function Metric({ label, value, detail }) {
  return <article className="metric-card"><span className="eyebrow">{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

export default function App() {
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
      const response = await fetch(API + '/api/market/overview?' + query)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || 'Market service returned ' + response.status)
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
  const biasClass = analysis?.bias === 'Bullish' ? 'positive' : analysis?.bias === 'Bearish' ? 'negative' : ''
  const timeframes = ['4H', '1H', '15M', '5M']

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark">E</span><span>edgepilot<span className="brand-dot">.</span></span></a>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav"><a className="nav-item active" href="#overview">◫ &nbsp; Overview</a><a className="nav-item" href="#analysis">⌁ &nbsp; Market analysis</a><a className="nav-item" href="#methodology">◎ &nbsp; Methodology</a></nav>
      <div className="sidebar-bottom"><div className="local-status"><i /> Local workspace</div><p>Research first.<br />Validate every assumption.</p><span>EDGE PILOT · PREVIEW</span></div>
    </aside>

    <section className="main-content" id="overview">
      <header className="topbar">
        <div><div className="breadcrumb">Workspace <span>/</span> Overview</div><h1>Market overview</h1></div>
        <div className="topbar-right"><span className="data-pill"><i /> Public market data</span><button className="refresh-button" onClick={refresh} disabled={loading}><span className={loading ? 'spin' : ''}>↻</span> Refresh</button></div>
      </header>

      <div className="notice"><b>i</b><p><strong>Research environment.</strong> EdgePilot displays public market data and educational analysis only. It does not provide financial advice or place real-money orders.</p></div>

      <section className="market-toolbar">
        <label className="asset-picker"><span>ASSET</span><select value={symbol} onChange={e => setSymbol(e.target.value)}>{symbols.map(s => <option key={s} value={s}>{s.replace('USDT', '')} / USDT</option>)}</select></label>
        <div className="interval-picker">{intervals.map(item => <button key={item.value} className={interval === item.value ? 'interval active' : 'interval'} onClick={() => setInterval(item.value)}>{item.label}</button>)}</div>
        <span className="market-source">SOURCE <b>BYBIT PUBLIC API</b></span>
      </section>

      {error && <div className="error-panel"><strong>Could not load market data</strong><span>{error}</span><small>Confirm the backend is running at {API}.</small></div>}

      <section className="price-heading">
        <div><span className="eyebrow">SELECTED MARKET · {symbol}</span><div className="price-line"><strong>{latest ? fmt(latest.close, latest.close < 1 ? 5 : 2) : '—'}</strong><span className="currency">USDT</span>{change != null && <span className={'change ' + (change >= 0 ? 'positive' : 'negative')}>{signed(change)}%</span>}</div></div>
        <span className="updated-label">{updated ? 'Updated ' + updated.toLocaleTimeString() : 'Awaiting connection'}</span>
      </section>

      <section className="chart-panel">
        <div className="panel-heading"><div><h2>Price movement</h2><p>Recent closing prices · {intervals.find(x => x.value === interval)?.label}</p></div><span className="live-label"><i /> {loading ? 'UPDATING' : 'CONNECTED'}</span></div>
        <div className="chart-wrap">{loading && !candles.length ? <div className="chart-empty">Loading market data…</div> : <PriceChart candles={candles} />}</div>
        <div className="chart-footer"><span>{candles.length ? new Date(candles[0].timestamp * 1000).toLocaleString() : '—'}</span><span>{latest ? new Date(latest.timestamp * 1000).toLocaleString() : '—'}</span></div>
      </section>

      <section className="metrics-grid">
        <Metric label="RECENT HIGH" value={data ? fmt(data.day_high) : '—'} detail="Last 96 candles · USDT" />
        <Metric label="RECENT LOW" value={data ? fmt(data.day_low) : '—'} detail="Last 96 candles · USDT" />
        <Metric label="RSI · 14" value={analysis ? fmt(analysis.rsi, 1) : '—'} detail={analysis?.rsi_state || 'Momentum indicator'} />
        <Metric label="ATR · 14" value={analysis ? fmt(analysis.atr_percent, 2) + '%' : '—'} detail="Volatility relative to price" />
      </section>

      <section className="analysis-section" id="analysis">
        <div className="section-title"><div><span className="eyebrow">HYBRID ENGINE</span><h2>Market context</h2></div><span className="muted-tag">Educational analysis · Not a trade signal</span></div>
        <div className="analysis-grid">
          <article className="bias-card"><span className="eyebrow">MULTI-TIMEFRAME BIAS</span><strong className={biasClass}>{analysis?.bias || '—'}</strong><div className="score-track"><span className={biasClass} style={{ width: Math.min(100, Math.abs(analysis?.score || 0)) + '%' }} /></div><div className="score-caption"><span>Confluence score</span><b>{analysis ? signed(analysis.score, 0) + '/100' : '—'}</b></div><p>Weighted descriptive context across 4H, 1H, 15M and 5M candles. This is not a probability of success.</p></article>
          <article className="timeframe-card"><div className="card-title-row"><h3>Timeframe alignment</h3><span className="tiny-tag">EMA + structure</span></div>{timeframes.map(label => { const item = analysis?.timeframes?.[label]; return <div className="timeframe-row" key={label}><span>{label}</span><div className="timeframe-bar"><i className={item?.bias === 'Bullish' ? 'positive-bg' : item?.bias === 'Bearish' ? 'negative-bg' : ''} style={{ width: Math.abs(item?.score || 0) + '%' }} /></div><b className={item?.bias === 'Bullish' ? 'positive' : item?.bias === 'Bearish' ? 'negative' : ''}>{item?.bias || '—'}</b></div> })}</article>
          <article className="detail-card"><div className="card-title-row"><h3>Indicator readings</h3><span className="tiny-tag">Selected interval</span></div><div className="detail-row"><span>EMA 20</span><b>{analysis ? fmt(analysis.ema20) : '—'}</b></div><div className="detail-row"><span>EMA 50</span><b>{analysis ? fmt(analysis.ema50) : '—'}</b></div><div className="detail-row"><span>MACD histogram</span><b>{analysis ? signed(analysis.macd_histogram, 4) : '—'}</b></div><div className="detail-row"><span>Relative volume</span><b>{analysis ? fmt(analysis.volume_ratio, 2) + '×' : '—'}</b></div><div className="detail-row"><span>Structure</span><b>{analysis?.structure || '—'}</b></div></article>
        </div>
      </section>

      <section className="methodology-panel" id="methodology"><div><span className="eyebrow">HOW THE ENGINE WORKS</span><h2>Confluence, not certainty.</h2><p>EdgePilot combines trend, momentum, volatility, volume and swing-structure context across multiple timeframes. Scores are descriptive and must be validated against historical data before drawing conclusions.</p></div><div className="method-tags"><span>EMA 20 / 50</span><span>RSI 14</span><span>MACD</span><span>ATR 14</span><span>Relative volume</span><span>Swing structure</span></div></section>
      <footer className="footer"><span>EDGE PILOT © 2026</span><span>Local research workspace</span></footer>
    </section>
  </main>
}
