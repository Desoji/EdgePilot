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
  const [liveTicker, setLiveTicker] = useState(null)
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] })
  const [recentTrades, setRecentTrades] = useState([])
  const [feedStatus, setFeedStatus] = useState('CONNECTING')
  const [paperPositions, setPaperPositions] = useState(() => { try { return JSON.parse(localStorage.getItem('edgepilot.paper.positions') || '[]') } catch { return [] } })
  const [paperHistory, setPaperHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('edgepilot.paper.history') || '[]') } catch { return [] } })
  const [paperQty, setPaperQty] = useState('0.001')
  const [paperStop, setPaperStop] = useState('')
  const [paperTarget, setPaperTarget] = useState('')
  const [paperMessage, setPaperMessage] = useState('')

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

  useEffect(() => {
    let socket
    let reconnectTimer
    let stopped = false
    const applyBookSide = (current, updates, snapshot) => {
      const next = new Map(snapshot ? [] : current.map(level => [level[0], level[1]]))
      for (const [price, size] of updates || []) {
        if (Number(size) === 0) next.delete(price)
        else next.set(price, size)
      }
      return [...next.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
    }
    const connect = () => {
      if (stopped) return
      setFeedStatus('CONNECTING')
      socket = new WebSocket('wss://stream.bybit.com/v5/public/linear')
      socket.onopen = () => {
        setFeedStatus('LIVE')
        socket.send(JSON.stringify({ op: 'subscribe', args: [
          'tickers.' + symbol,
          'orderbook.50.' + symbol,
          'publicTrade.' + symbol,
          'kline.' + interval + '.' + symbol
        ] }))
      }
      socket.onmessage = event => {
        let message
        try { message = JSON.parse(event.data) } catch { return }
        if (!message.topic || !message.data) return
        if (message.topic.startsWith('tickers.')) {
          setLiveTicker(current => ({ ...(current || {}), ...message.data }))
        } else if (message.topic.startsWith('orderbook.')) {
          const snapshot = message.type === 'snapshot'
          setOrderBook(current => ({
            bids: applyBookSide(current.bids, message.data.b, snapshot).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 12),
            asks: applyBookSide(current.asks, message.data.a, snapshot).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 12)
          }))
        } else if (message.topic.startsWith('publicTrade.')) {
          setRecentTrades(current => [...message.data, ...current].slice(0, 30))
        } else if (message.topic.startsWith('kline.')) {
          setData(current => {
            if (!current) return current
            const updates = Array.isArray(message.data) ? message.data : [message.data]
            const next = [...(current.candles || [])]
            for (const item of updates) {
              const candle = {
                timestamp: Math.floor(Number(item.start) / 1000),
                open: Number(item.open), high: Number(item.high), low: Number(item.low),
                close: Number(item.close), volume: Number(item.volume)
              }
              const index = next.findIndex(row => row.timestamp === candle.timestamp)
              if (index >= 0) next[index] = candle
              else next.push(candle)
            }
            return { ...current, candles: next.slice(-160) }
          })
          setUpdated(new Date())
        }
      }
      socket.onerror = () => setFeedStatus('RECONNECTING')
      socket.onclose = () => {
        if (!stopped) {
          setFeedStatus('RECONNECTING')
          reconnectTimer = window.setTimeout(connect, 2500)
        }
      }
    }
    setLiveTicker(null)
    setOrderBook({ bids: [], asks: [] })
    setRecentTrades([])
    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
    }
  }, [symbol, interval])

  const candles = data?.candles || []
  const latest = candles[candles.length - 1]
  const displayedPrice = liveTicker?.lastPrice ? Number(liveTicker.lastPrice) : latest?.close
  const previous = candles[candles.length - 2]
  const change = latest && previous ? (latest.close - previous.close) / previous.close * 100 : null
  const analysis = data?.analysis
  const derivatives = data?.derivatives || {}
  const liveDerivatives = {
    ...derivatives,
    mark_price: liveTicker?.markPrice ?? derivatives.mark_price,
    index_price: liveTicker?.indexPrice ?? derivatives.index_price,
    funding_rate: liveTicker?.fundingRate ?? derivatives.funding_rate,
    open_interest: liveTicker?.openInterest ?? derivatives.open_interest
  }
  const biasClass = analysis?.bias === 'Bullish' ? 'positive' : analysis?.bias === 'Bearish' ? 'negative' : ''

  useEffect(() => {
    localStorage.setItem('edgepilot.paper.positions', JSON.stringify(paperPositions))
  }, [paperPositions])

  useEffect(() => {
    localStorage.setItem('edgepilot.paper.history', JSON.stringify(paperHistory.slice(0, 50)))
  }, [paperHistory])

  useEffect(() => {
    if (!displayedPrice || !Number.isFinite(displayedPrice)) return
    setPaperPositions(current => {
      const stillOpen = []
      const newlyClosed = []
      for (const position of current) {
        if (position.symbol !== symbol) {
          stillOpen.push(position)
          continue
        }
        const hitStop = position.stopLoss != null && (position.side === 'LONG' ? displayedPrice <= position.stopLoss : displayedPrice >= position.stopLoss)
        const hitTarget = position.takeProfit != null && (position.side === 'LONG' ? displayedPrice >= position.takeProfit : displayedPrice <= position.takeProfit)
        if (!hitStop && !hitTarget) {
          stillOpen.push(position)
          continue
        }
        const exitPrice = hitStop ? position.stopLoss : position.takeProfit
        const direction = position.side === 'LONG' ? 1 : -1
        newlyClosed.push({ ...position, exitPrice, exitTime: new Date().toISOString(), closeReason: hitStop ? 'Stop-loss' : 'Take-profit', realisedPnl: (exitPrice - position.entryPrice) * position.quantity * direction })
      }
      if (newlyClosed.length) setPaperHistory(history => [...newlyClosed, ...history].slice(0, 50))
      return stillOpen
    })
  }, [displayedPrice, symbol])

  const openPaperPosition = side => {
    const quantity = Number(paperQty)
    const stop = paperStop.trim() === '' ? null : Number(paperStop)
    const target = paperTarget.trim() === '' ? null : Number(paperTarget)
    if (!displayedPrice || !Number.isFinite(displayedPrice)) {
      setPaperMessage('Waiting for a live market price.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPaperMessage('Enter a quantity greater than zero.')
      return
    }
    if ((stop != null && (!Number.isFinite(stop) || stop <= 0)) || (target != null && (!Number.isFinite(target) || target <= 0))) {
      setPaperMessage('Stop-loss and take-profit must be valid positive prices.')
      return
    }
    if (side === 'LONG' && ((stop != null && stop >= displayedPrice) || (target != null && target <= displayedPrice))) {
      setPaperMessage('For a simulated LONG, stop-loss must be below entry and take-profit above entry.')
      return
    }
    if (side === 'SHORT' && ((stop != null && stop <= displayedPrice) || (target != null && target >= displayedPrice))) {
      setPaperMessage('For a simulated SHORT, stop-loss must be above entry and take-profit below entry.')
      return
    }
    const position = { id: String(Date.now()), symbol, side, quantity, entryPrice: displayedPrice, stopLoss: stop, takeProfit: target, openedAt: new Date().toISOString() }
    setPaperPositions(current => [position, ...current])
    setPaperMessage('Paper position opened. No exchange order was sent.')
  }

  const closePaperPosition = id => {
    const position = paperPositions.find(item => item.id === id)
    if (!position || !displayedPrice) return
    const direction = position.side === 'LONG' ? 1 : -1
    const closed = { ...position, exitPrice: displayedPrice, exitTime: new Date().toISOString(), closeReason: 'Manual close', realisedPnl: (displayedPrice - position.entryPrice) * position.quantity * direction }
    setPaperPositions(current => current.filter(item => item.id !== id))
    setPaperHistory(current => [closed, ...current].slice(0, 50))
    setPaperMessage('Paper position closed at the current displayed price.')
  }

  const paperOpenPnl = paperPositions.reduce((total, position) => {
    if (position.symbol !== symbol || !displayedPrice) return total
    return total + (displayedPrice - position.entryPrice) * position.quantity * (position.side === 'LONG' ? 1 : -1)
  }, 0)
  const paperRealisedPnl = paperHistory.reduce((total, position) => total + Number(position.realisedPnl || 0), 0)

  return <div className="futures-page">
    <header className="topbar">
      <div><div className="breadcrumb">Workspace <span>/</span> Futures</div><h1>Futures analysis</h1></div>
      <div className="topbar-right"><span className={'data-pill ' + (feedStatus === 'LIVE' ? 'feed-live' : '')}><i /> {feedStatus === 'LIVE' ? 'Live public feed' : feedStatus + ' · public feed'}</span><button className="refresh-button" onClick={refresh} disabled={loading}><span>{loading ? '◌' : '↻'}</span> Refresh</button></div>
    </header>

    <div className="notice"><b>i</b><p><strong>Research environment.</strong> This page reads public Bybit USDT perpetual data. It does not connect to a trading account, recommend leverage, or place orders. Funding and open interest are context metrics, not predictions.</p></div>

    <section className="market-toolbar">
      <label className="asset-picker"><span>PERPETUAL CONTRACT</span><select value={symbol} onChange={e => setSymbol(e.target.value)}>{symbols.map(s => <option key={s} value={s}>{s.replace('USDT', '')} / USDT</option>)}</select></label>
      <div className="interval-picker">{intervals.map(item => <button key={item.value} className={interval === item.value ? 'interval active' : 'interval'} onClick={() => setInterval(item.value)}>{item.label}</button>)}</div>
      <span className="market-source">CONTRACT <b>USDT LINEAR · PERPETUAL</b></span>
    </section>

    {error && <div className="error-panel"><strong>Could not load futures data</strong><span>{error}</span><small>Confirm the backend is running at {API} and the symbol is supported by Bybit linear markets.</small></div>}

    <section className="price-heading">
      <div><span className="eyebrow">LINEAR PERPETUAL · {symbol}</span><div className="price-line"><strong>{displayedPrice != null ? fmt(displayedPrice, displayedPrice < 1 ? 5 : 2) : '—'}</strong><span className="currency">USDT</span>{change != null && <span className={'change ' + (change >= 0 ? 'positive' : 'negative')}>{signed(change)}%</span>}</div></div>
      <span className="updated-label">{updated ? 'Updated ' + updated.toLocaleTimeString() : 'Awaiting connection'}</span>
    </section>

    <section className="chart-panel">
      <div className="panel-heading"><div><h2>Perpetual price movement</h2><p>Recent closing prices · {intervals.find(x => x.value === interval)?.label}</p></div><span className={'live-label ' + (feedStatus === 'LIVE' ? 'feed-live' : '')}><i /> {feedStatus}</span></div>
      <div className="chart-wrap">{loading && !candles.length ? <div className="chart-empty">Loading futures market data…</div> : <FuturesChart candles={candles} />}</div>
      <div className="chart-footer"><span>{candles.length ? new Date(candles[0].timestamp * 1000).toLocaleString() : '—'}</span><span>{latest ? new Date(latest.timestamp * 1000).toLocaleString() : '—'}</span></div>
    </section>

    <section className="metrics-grid futures-metrics">
      <FuturesMetric label="MARK PRICE" value={fmt(liveDerivatives.mark_price, 2)} detail="Exchange-reported mark price · USDT" />
      <FuturesMetric label="INDEX PRICE" value={fmt(liveDerivatives.index_price, 2)} detail="Underlying index reference · USDT" />
      <FuturesMetric label="FUNDING RATE" value={liveDerivatives.funding_rate == null ? '—' : signed(liveDerivatives.funding_rate * 100, 4) + '%'} detail="Current rate · next settlement is exchange-defined" />
      <FuturesMetric label="OPEN INTEREST" value={liveDerivatives.open_interest == null ? '—' : fmt(liveDerivatives.open_interest, 2)} detail="Displayed in contract units by provider" />
    </section>


    <section className="live-market-grid">
      <article className="live-panel">
        <div className="card-title-row"><div><h3>Live order book</h3><span className="tiny-tag">Top 12 · USDT</span></div><span className="stream-state">{feedStatus}</span></div>
        <div className="book-head"><span>PRICE (USDT)</span><span>SIZE</span></div>
        <div className="book-side asks">{orderBook.asks.slice().reverse().map(([price, size]) => <div className="book-row" key={'a' + price}><b>{fmt(price, Number(price) < 1 ? 5 : 2)}</b><span>{fmt(size, 3)}</span></div>)}</div>
        <div className="book-mid">{liveTicker?.bid1Price && liveTicker?.ask1Price ? <><b>{fmt(liveTicker.bid1Price, 2)} / {fmt(liveTicker.ask1Price, 2)}</b><small>Best bid / ask</small></> : 'Waiting for quotes'}</div>
        <div className="book-side bids">{orderBook.bids.map(([price, size]) => <div className="book-row" key={'b' + price}><b>{fmt(price, Number(price) < 1 ? 5 : 2)}</b><span>{fmt(size, 3)}</span></div>)}</div>
      </article>
      <article className="live-panel">
        <div className="card-title-row"><div><h3>Recent market trades</h3><span className="tiny-tag">Public trade stream</span></div><span className="tiny-tag">{recentTrades.length} updates</span></div>
        <div className="trade-head"><span>PRICE</span><span>SIZE</span><span>TIME</span></div>
        <div className="trade-list">{recentTrades.slice(0, 18).map((trade, index) => <div className="trade-row" key={(trade.i || '') + '-' + index}><b className={trade.S === 'Buy' ? 'positive' : 'negative'}>{fmt(trade.p, Number(trade.p) < 1 ? 5 : 2)}</b><span>{fmt(trade.v, 3)}</span><small>{new Date(Number(trade.T)).toLocaleTimeString()}</small></div>)}
          {!recentTrades.length && <div className="chart-empty">Waiting for public trades…</div>}
        </div>
      </article>

      <article className="live-panel position-monitor">
        <div className="card-title-row"><div><h3>Paper position manager</h3><span className="tiny-tag">Local simulation · No exchange orders</span></div><span className="tiny-tag">{paperPositions.length} open</span></div>
        <div className="paper-summary">
          <div><small>UNREALISED P&amp;L · {symbol}</small><b className={paperOpenPnl >= 0 ? 'positive' : 'negative'}>{signed(paperOpenPnl, 4)} USDT</b></div>
          <div><small>REALised P&amp;L · HISTORY</small><b className={paperRealisedPnl >= 0 ? 'positive' : 'negative'}>{signed(paperRealisedPnl, 4)} USDT</b></div>
        </div>
        <div className="paper-form">
          <label>Quantity<input type="number" min="0.000001" step="any" value={paperQty} onChange={e => setPaperQty(e.target.value)} /></label>
          <label>Stop-loss price <input type="number" min="0" step="any" placeholder="Optional" value={paperStop} onChange={e => setPaperStop(e.target.value)} /></label>
          <label>Take-profit price <input type="number" min="0" step="any" placeholder="Optional" value={paperTarget} onChange={e => setPaperTarget(e.target.value)} /></label>
          <div className="paper-actions"><button className="paper-long" onClick={() => openPaperPosition('LONG')} disabled={!displayedPrice}>Open simulated LONG</button><button className="paper-short" onClick={() => openPaperPosition('SHORT')} disabled={!displayedPrice}>Open simulated SHORT</button></div>
          {paperMessage && <p className="paper-message">{paperMessage}</p>}
          <small>Entries use the current displayed public price. P&amp;L excludes fees, funding, slippage and liquidation effects. This is an educational simulation only.</small>
        </div>
        <div className="paper-table-wrap"><h4>Open positions</h4>
          {paperPositions.length ? <table className="paper-table"><thead><tr><th>MARKET / SIDE</th><th>ENTRY</th><th>LIVE P&amp;L</th><th>STOP</th><th>TARGET</th><th></th></tr></thead><tbody>{paperPositions.map(position => { const mark = position.symbol === symbol ? displayedPrice : null; const pnl = mark ? (mark - position.entryPrice) * position.quantity * (position.side === 'LONG' ? 1 : -1) : null; return <tr key={position.id}><td><b>{position.symbol}</b><small className={position.side === 'LONG' ? 'positive' : 'negative'}>{position.side}</small></td><td>{fmt(position.entryPrice, position.entryPrice < 1 ? 5 : 2)}</td><td className={pnl == null ? '' : pnl >= 0 ? 'positive' : 'negative'}>{pnl == null ? 'Switch market to mark' : signed(pnl, 4) + ' USDT'}</td><td>{position.stopLoss == null ? '—' : fmt(position.stopLoss, 2)}</td><td>{position.takeProfit == null ? '—' : fmt(position.takeProfit, 2)}</td><td><button className="paper-close" onClick={() => closePaperPosition(position.id)} disabled={!mark}>Close</button></td></tr> })}</tbody></table> : <div className="paper-empty">No simulated positions are open. Use the controls above to create a paper position.</div>}
        </div>
        <div className="paper-table-wrap"><h4>Closed simulation history</h4>
          {paperHistory.length ? <table className="paper-table"><thead><tr><th>MARKET / SIDE</th><th>ENTRY</th><th>EXIT</th><th>RESULT</th><th>REASON</th></tr></thead><tbody>{paperHistory.slice(0, 10).map(position => <tr key={position.id + position.exitTime}><td><b>{position.symbol}</b><small>{position.side}</small></td><td>{fmt(position.entryPrice, 2)}</td><td>{fmt(position.exitPrice, 2)}</td><td className={position.realisedPnl >= 0 ? 'positive' : 'negative'}>{signed(position.realisedPnl, 4)} USDT</td><td>{position.closeReason}</td></tr>)}</tbody></table> : <div className="paper-empty">Closed paper positions will appear here.</div>}
        </div>
      </article>
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
