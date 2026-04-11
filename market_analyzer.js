/**
 * TradingView Market Data Analyzer
 * ─────────────────────────────────
 * Connects to TradingView Desktop via Chrome DevTools Protocol (CDP)
 * and exposes a unified API to fetch ANY market data:
 *   - Stocks   : AAPL, TSLA, EURONEXT:MC (LVMH)
 *   - Indices  : EURONEXT:CAC40, SP:SPX, INDEX:VIX
 *   - Crypto   : BINANCE:BTCUSDT, COINBASE:ETHUSD
 *   - Forex    : FX:EURUSD, OANDA:GBPUSD
 *   - Futures  : CME:ES1!, NYMEX:CL1!
 *   - Options  : OPRA:AAPL*  (options chain)
 *
 * Prerequisites:
 *   1. TradingView Desktop running with --remote-debugging-port=9222
 *      macOS : open -a "TradingView" --args --remote-debugging-port=9222
 *      Windows: "C:\...\TradingView.exe" --remote-debugging-port=9222
 *   2. npm install ws chrome-remote-interface
 */

'use strict';

const http  = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { TVFeed } = require('./tv_feed');

// ─── Low-level CDP transport ──────────────────────────────────────────────────

class CDPTransport extends EventEmitter {
  constructor (host = 'localhost', port = 9222) {
    super();
    this.host    = host;
    this.port    = port;
    this.ws      = null;
    this._id     = 0;
    this._calls  = new Map(); // id → { resolve, reject }
  }

  /** Fetch the list of debuggable targets from TradingView */
  async getTargets () {
    return new Promise((resolve, reject) => {
      http.get(`http://${this.host}:${this.port}/json`, res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  /** Connect to the first page target (or a specific one by id) */
  async connect (targetId = null) {
    const targets = await this.getTargets();
    if (!targets.length) throw new Error('No CDP targets found — is TradingView running with --remote-debugging-port=9222?');

    const target = targetId
      ? targets.find(t => t.id === targetId)
      : targets.find(t => t.type === 'page') ?? targets[0];

    if (!target) throw new Error(`Target "${targetId}" not found`);

    this.ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.once('open',    resolve);
      this.ws.once('error',   reject);
    });

    this.ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id != null && this._calls.has(msg.id)) {
        const { resolve, reject } = this._calls.get(msg.id);
        this._calls.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.emit(msg.method, msg.params);
      }
    });

    return this;
  }

  /** Send a raw CDP command */
  send (method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._calls.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate JavaScript in TradingView's page context.
   * @param {string}  expr         – JS expression (must be serialisable)
   * @param {boolean} awaitPromise – set true when expr returns a Promise
   */
  async eval (expr, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', {
      expression:   expr,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails?.exception?.description
                ?? res.exceptionDetails?.text
                ?? 'Unknown JS exception';
      throw new Error(`JS error: ${msg}`);
    }
    return res.result?.value;
  }

  disconnect () { this.ws?.close(); }
}

// ─── TradingView chart API helpers ────────────────────────────────────────────

/**
 * Returns a JS snippet that resolves the active tvWidget.
 * TradingView Desktop may expose it under different global names.
 */
// TradingView Desktop exposes the widget as `TradingViewApi`
const TV_WIDGET_EXPR = `
  (function findWidget() {
    const known = ['TradingViewApi', 'tvWidget', '_tvWidget', '__tv_widget'];
    for (const name of known) {
      if (window[name] && typeof window[name].activeChart === 'function') return window[name];
    }
    for (const key of Object.keys(window)) {
      try {
        const v = window[key];
        if (v && typeof v.activeChart === 'function') return v;
      } catch (_) {}
    }
    return null;
  })()
`;

// ─── Main Analyzer class ──────────────────────────────────────────────────────

class TradingViewAnalyzer {
  /**
   * @param {{ host?: string, port?: number, timeout?: number }} opts
   *
   * TradingView Desktop does NOT need to be open for quote/ohlcv/scan/search/options.
   * CDP (Desktop) is only needed for getIndicators() and getKeyLevels().
   */
  constructor (opts = {}) {
    this.cdp      = new CDPTransport(opts.host ?? 'localhost', opts.port ?? 9222);
    this.feed     = new TVFeed();          // WebSocket data feed — main data source
    this.timeout  = opts.timeout ?? 8000;
    this._cdpReady  = false;
    this._feedReady = false;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  /**
   * Connect to the TradingView data WebSocket.
   * TradingView Desktop does NOT need to be open.
   */
  async connect () {
    await this.feed.connect();
    this._feedReady = true;
    console.log('[TradingView] Data feed connected');
    return this;
  }

  /**
   * Also connect to TradingView Desktop via CDP (optional).
   * Required only for getIndicators() and getKeyLevels().
   */
  async connectDesktop () {
    await this.cdp.connect();
    this._cdpReady = true;
    console.log(`[TradingView] Desktop connected via CDP on port ${this.cdp.port}`);
    return this;
  }

  disconnect () {
    this.feed.disconnect();
    if (this._cdpReady) this.cdp.disconnect();
    this._feedReady = false;
    this._cdpReady  = false;
  }

  _assertFeed () {
    if (!this._feedReady) throw new Error('Call .connect() first');
  }
  _assertCDP () {
    if (!this._cdpReady) throw new Error('Call .connectDesktop() first (requires TradingView Desktop open with --remote-debugging-port=9222)');
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Set symbol on the active chart and wait for the chart to confirm it.
   * Uses a global flag instead of a Promise to avoid CDP garbage-collection issues.
   */
  async _setSymbol (symbol, timeframe, settle = 2000) {
    // Reset flag
    await this.cdp.eval('window.__tvReady = false;');

    // Trigger symbol (and optional resolution) change
    await this.cdp.eval(`
      (function () {
        const w = ${TV_WIDGET_EXPR};
        if (!w) { window.__tvReady = 'no-widget'; return; }
        const chart = w.activeChart();
        ${timeframe ? `chart.setResolution('${_tvResolution(timeframe)}', function(){});` : ''}
        chart.setSymbol('${symbol}', function () { window.__tvReady = true; });
      })();
    `);

    // Poll until callback fires (max 6 s)
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const ready = await this.cdp.eval('window.__tvReady');
      if (ready === true) break;
      if (typeof ready === 'string') throw new Error(`_setSymbol: ${ready}`);
      await _sleep(250);
    }

    // Let the data feed populate after symbol confirmed
    await _sleep(settle);
    return { symbol, timeframe };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Get a real-time quote snapshot for any symbol.
   *
   * @param {string} symbol  e.g. "AAPL", "EURONEXT:CAC40", "BINANCE:BTCUSDT"
   * @returns {{ symbol, price, open, high, low, volume, change, changePct, time }}
   *
   * @example
   * const q = await analyzer.getQuote('EURONEXT:CAC40');
   * console.log(q.price); // 8053.14
   */
  async getQuote (symbol) {
    this._assertFeed();
    const feed = new TVFeed();
    await feed.connect();
    try     { return await feed.getQuote(symbol); }
    finally { feed.disconnect(); }
  }

  /**
   * Fetch OHLCV bars for any symbol and timeframe.
   *
   * @param {string} symbol      e.g. "EURONEXT:CAC40"
   * @param {string} timeframe   "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M"
   * @param {number} bars        Number of bars to return (default 100)
   * @returns {Array<{ time, open, high, low, close, volume }>}
   *
   * @example
   * const candles = await analyzer.getOHLCV('EURONEXT:CAC40', '1D', 50);
   */
  async getOHLCV (symbol, timeframe = '1D', bars = 100) {
    this._assertFeed();
    const feed = new TVFeed();
    await feed.connect();
    try     { return await feed.getOHLCV(symbol, timeframe, bars); }
    finally { feed.disconnect(); }
  }

  /**
   * Get the current values of all visible studies / indicators on the chart.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @returns {Array<{ name, values }>}
   *
   * @example
   * const inds = await analyzer.getIndicators('AAPL', '1D');
   * // [{ name: 'RSI', values: { RSI: 58.3 } }, { name: 'MACD', values: {...} }]
   */
  async getIndicators (symbol, timeframe = '1D') {
    this._assertCDP();
    await this._setSymbol(symbol, timeframe, 2500);

    return this.cdp.eval(`
      (function () {
        const w = ${TV_WIDGET_EXPR};
        if (!w) return { error: 'widget not found' };
        try {
          const chart   = w.activeChart();
          const studies = chart.getAllStudies ? chart.getAllStudies() : [];
          return studies.map(s => {
            const study = chart.getStudyById ? chart.getStudyById(s.id) : null;
            return {
              id:     s.id,
              name:   s.name,
              inputs: study ? study.getInputsInfo() : null,
            };
          });
        } catch (e) { return { error: e.message }; }
      })()
    `);
  }

  /**
   * Fetch support / resistance lines (Pine Script drawings, price lines).
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @returns {Array<{ price, type, text }>}
   */
  async getKeyLevels (symbol, timeframe = '1D') {
    this._assertCDP();
    await this._setSymbol(symbol, timeframe, 2000);

    return this.cdp.eval(`
      (function () {
        const w = ${TV_WIDGET_EXPR};
        if (!w) return { error: 'widget not found' };
        try {
          const chart = w.activeChart();
          const lines = chart.getPineLines ? chart.getPineLines() : [];
          return lines.map(l => ({
            price: l.getPrice ? l.getPrice() : null,
            text:  l.getText  ? l.getText()  : null,
            color: l.getColor ? l.getColor() : null,
          }));
        } catch (e) { return { error: e.message }; }
      })()
    `);
  }

  /**
   * Fetch options chain data for a symbol.
   * TradingView must have the options tab open/accessible.
   *
   * Returns strikes grouped by expiry.
   *
   * @param {string} symbol  e.g. "AAPL", "TSLA"
   * @returns {{ expiries: string[], chain: Record<string, Strike[]> }}
   *
   * @example
   * const opts = await analyzer.getOptionsChain('AAPL');
   * console.log(opts.chain['2024-01-19']); // → [{ strike, callBid, callAsk, putBid, putAsk, iv, oi, volume }]
   */
  async getOptionsChain (symbol) {
    return _fetchOptionsData(symbol);
  }

  /**
   * Full market analysis: quote + OHLCV + indicators for one or more symbols.
   *
   * @param {string|string[]} symbols   Single symbol or array
   * @param {string[]}        timeframes e.g. ['1D', '4h', '1W']
   * @returns {Record<string, { quote, ohlcv, indicators }>}
   *
   * @example
   * const report = await analyzer.scan(['EURONEXT:CAC40', 'AAPL', 'BINANCE:BTCUSDT'], ['1D', '4h']);
   */
  async scan (symbols, timeframes = ['1D']) {
    this._assertFeed();
    const list   = Array.isArray(symbols) ? symbols : [symbols];
    const report = {};
    const feed   = new TVFeed();
    await feed.connect();

    try {
      for (const sym of list) {
        report[sym] = {};
        for (const tf of timeframes) {
          process.stdout.write(`[scan] ${sym} ${tf}... `);
          const ohlcv = await feed.getOHLCV(sym, tf, 50);
          const quote = ohlcv.length ? (() => {
            const last = ohlcv[ohlcv.length - 1];
            const prev = ohlcv[ohlcv.length - 2] ?? last;
            const chg  = parseFloat((last.close - prev.close).toFixed(4));
            return { symbol: sym, price: last.close, open: last.open, high: last.high, low: last.low,
                     volume: last.volume, prevClose: prev.close, change: chg,
                     changePct: parseFloat((chg / prev.close * 100).toFixed(2)),
                     date: last.date, time: last.time,
                     isoTime: new Date(last.time * 1000).toISOString() };
          })() : { error: 'no data' };

          report[sym][tf] = {
            quote,
            ohlcv,
            bias: _computeBias(quote, ohlcv),
          };
          console.log(`bias=${report[sym][tf].bias}`);
        }
      }
    } finally {
      feed.disconnect();
    }
    return report;
  }

  /**
   * Search for any symbol by name / ticker / keyword.
   * Uses TradingView's symbol search API.
   *
   * @param {string} query     e.g. "CAC", "apple", "bitcoin"
   * @param {string} type      "stock" | "crypto" | "forex" | "index" | "futures" | "bonds" | "" (all)
   * @param {number} limit
   * @returns {Array<{ symbol, description, exchange, type }>}
   *
   * @example
   * const results = await analyzer.search('CAC');
   * // [{ symbol: 'EURONEXT:CAC40', description: 'CAC 40 Index', ... }]
   */
  async search (query, type = '', limit = 10) {
    return _tvSymbolSearch(query, type, limit);
  }
}

// ─── Bias computation (simple, no external deps) ──────────────────────────────

function _computeBias (quote, ohlcv) {
  if (!ohlcv?.length || ohlcv.error) return 'unknown';

  const closes = ohlcv.map(b => b.close);
  const ema21  = _ema(closes, 21);
  const ema50  = _ema(closes, 50);
  const rsi    = _rsi(closes, 14);
  const last   = closes.at(-1);

  let bullSignals = 0;
  let bearSignals = 0;

  if (ema21 > ema50) bullSignals++; else bearSignals++;
  if (last  > ema21) bullSignals++; else bearSignals++;
  if (last  > ema50) bullSignals++; else bearSignals++;
  if (rsi   > 50)    bullSignals++; else bearSignals++;

  const score = bullSignals - bearSignals;
  return score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
}

function _ema (data, period) {
  if (data.length < period) return data.at(-1) ?? 0;
  const k   = 2 / (period + 1);
  let  ema  = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
  return ema;
}

function _rsi (data, period = 14) {
  if (data.length < period + 1) return 50;
  const gains  = [], losses = [];
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let avgGain  = gains.reduce((a, b)  => a + b, 0) / period;
  let avgLoss  = losses.reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain  = (avgGain  * (period - 1) + (d > 0 ? d  : 0)) / period;
    avgLoss  = (avgLoss  * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── TradingView Resolution mapping ──────────────────────────────────────────

const RESOLUTION_MAP = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1D': 'D', '1W': 'W', '1M': 'M',
  // Also accept bare numbers / TV codes
  '1': '1', '5': '5', '15': '15', '60': '60', '240': '240', 'D': 'D', 'W': 'W',
};

function _tvResolution (tf) {
  return RESOLUTION_MAP[tf] ?? tf;
}

// ─── TradingView Symbol Search (public REST API) ──────────────────────────────

function _tvSymbolSearch (query, type = '', limit = 10) {
  const params = new URLSearchParams({
    text:     query,
    type:     type,
    exchange: '',
    lang:     'en',
    domain:   'production',
  });

  const url = `https://symbol-search.tradingview.com/symbol_search/?${params}&limit=${limit}`;

  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'application/json',
        'Referer':    'https://www.tradingview.com/',
        'Origin':     'https://www.tradingview.com',
      },
    }, res => {
      // Follow redirect if needed
      if (res.statusCode === 301 || res.statusCode === 302) {
        return https.get(res.headers.location, resolve).on('error', reject);
      }
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const json    = JSON.parse(buf);
          const list    = Array.isArray(json) ? json : (json.symbols ?? json.results ?? []);
          const symbols = list.map(s => ({
            symbol:      `${s.exchange}:${s.symbol}`,
            ticker:      s.symbol,
            description: s.description,
            exchange:    s.exchange,
            type:        s.type,
            currency:    s.currency_code,
          }));
          resolve(symbols);
        } catch (e) { reject(new Error(`Search parse error (HTTP ${res.statusCode}): ${e.message}\nBody: ${buf.slice(0, 300)}`)); }
      });
    }).on('error', reject);
  });
}

// ─── TradingView Options data (public API) ────────────────────────────────────

function _fetchOptionsData (symbol) {
  // TradingView's options endpoint (public, no auth required for basic data)
  const url = `https://options.tradingview.com/options/contract/symbol?symbol=${encodeURIComponent(symbol)}&type=americanoption`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tradingview.com/' } }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          // Shape: { expiries: [...], chain: { [date]: [{ strike, c_bid, c_ask, p_bid, p_ask, iv, oi, volume }] } }
          resolve(_parseOptionsResponse(json, symbol));
        } catch (e) {
          resolve({ error: `Options parse error: ${e.message}`, raw: buf.slice(0, 200) });
        }
      });
    }).on('error', reject);
  });
}

function _parseOptionsResponse (raw, symbol) {
  if (!raw?.data) return { symbol, expiries: [], chain: {}, raw };

  const chain = {};
  const expiries = [];

  for (const row of raw.data) {
    const exp = row.expiration ?? row.exp_date ?? 'unknown';
    if (!chain[exp]) { chain[exp] = []; expiries.push(exp); }
    chain[exp].push({
      strike:    row.strike,
      callBid:   row.call?.bid,
      callAsk:   row.call?.ask,
      callIV:    row.call?.iv,
      callOI:    row.call?.oi,
      callVol:   row.call?.volume,
      callDelta: row.call?.delta,
      callTheta: row.call?.theta,
      putBid:    row.put?.bid,
      putAsk:    row.put?.ask,
      putIV:     row.put?.iv,
      putOI:     row.put?.oi,
      putVol:    row.put?.volume,
      putDelta:  row.put?.delta,
      putTheta:  row.put?.theta,
    });
  }
  return { symbol, expiries: expiries.sort(), chain };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { TradingViewAnalyzer, TradingViewCDP: CDPTransport };
