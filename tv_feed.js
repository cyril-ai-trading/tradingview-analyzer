/**
 * TradingView WebSocket Data Feed
 * ─────────────────────────────────────────────────────────────────
 * Connects DIRECTLY to TradingView's data servers (no CDP needed).
 * Works for any symbol available on TradingView.
 *
 * Protocol:  wss://data.tradingview.com/socket.io/websocket
 * Framing:   ~m~{length}~m~{json}
 * Heartbeat: ~h~{n}  → reply with same message
 */

'use strict';

const WebSocket = require('ws');

// ─── Message framing ──────────────────────────────────────────────────────────

function encode (obj) {
  const s = JSON.stringify(obj);
  return `~m~${s.length}~m~${s}`;
}

function decode (raw) {
  const results = [];
  // A single frame may contain multiple ~m~...~m~... messages
  let rest = raw;
  while (rest.length) {
    const match = rest.match(/^~m~(\d+)~m~/);
    if (!match) break;
    const len    = parseInt(match[1], 10);
    const start  = match[0].length;
    const body   = rest.slice(start, start + len);
    rest         = rest.slice(start + len);
    if (body.startsWith('~h~')) {
      results.push({ type: 'heartbeat', n: body.slice(3) });
    } else {
      try { results.push({ type: 'msg', data: JSON.parse(body) }); }
      catch (_) { results.push({ type: 'raw', data: body }); }
    }
  }
  return results;
}

// ─── Random session ID ────────────────────────────────────────────────────────

function uid () {
  return Math.random().toString(36).slice(2, 14);
}

// ─── Main Feed class ──────────────────────────────────────────────────────────

class TVFeed {
  constructor () {
    this.ws        = null;
    this._handlers = []; // [{ test, resolve, reject, timer }]
  }

  // ── Connect ─────────────────────────────────────────────────────────────────

  connect () {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(
        'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2024_12_14-09_50&type=chart',
        {
          headers: {
            Origin:     'https://www.tradingview.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          },
        }
      );

      this.ws.once('open',  () => resolve(this));
      this.ws.once('error', reject);

      this.ws.on('message', (raw) => {
        const frames = decode(raw.toString());
        for (const frame of frames) {
          if (frame.type === 'heartbeat') {
            // Reply to keep-alive
            this.ws.send(`~m~${('~h~' + frame.n).length}~m~~h~${frame.n}`);
          } else if (frame.type === 'msg') {
            this._dispatch(frame.data);
          }
        }
      });
    });
  }

  disconnect () {
    this.ws?.close();
  }

  // ── Send raw message ─────────────────────────────────────────────────────────

  _send (m, p) {
    this.ws.send(encode({ m, p }));
  }

  // ── Event dispatch ────────────────────────────────────────────────────────────

  _dispatch (msg) {
    for (let i = this._handlers.length - 1; i >= 0; i--) {
      const h = this._handlers[i];
      if (h.test(msg)) {
        clearTimeout(h.timer);
        this._handlers.splice(i, 1);
        h.resolve(msg);
      }
    }
  }

  _waitFor (test, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._handlers = this._handlers.filter(h => h.resolve !== resolve);
        reject(new Error('TVFeed timeout waiting for message'));
      }, timeout);
      this._handlers.push({ test, resolve, reject, timer });
    });
  }

  // ── High-level API ────────────────────────────────────────────────────────────

  /**
   * Fetch OHLCV bars for any TradingView symbol.
   *
   * @param {string} symbol     e.g. "EURONEXT:CAC40", "NASDAQ:AAPL", "BINANCE:BTCUSDT"
   * @param {string} timeframe  "1","5","15","60","240","D","W","M"
   * @param {number} bars       number of bars (max ~5000)
   * @returns {Array<{time, date, open, high, low, close, volume}>}
   */
  async getOHLCV (symbol, timeframe = 'D', bars = 300) {
    const csId  = 'cs_' + uid();
    const symId = 'sds_sym_1';
    const serId = 'sds_1';
    const tv    = _tvResolution(timeframe);
    const sym   = _normalizeSymbol(symbol);

    // 1. Authenticate + create chart session
    this._send('set_auth_token',      ['unauthorized_user_token']);
    this._send('set_locale',          ['en', 'US']);
    this._send('chart_create_session',[csId, '']);

    // 2. Resolve symbol
    this._send('resolve_symbol', [
      csId, symId,
      `={"symbol":"${sym}","adjustment":"splits"}`,
    ]);

    // 3. Create series
    this._send('create_series', [csId, serId, 's1', symId, tv, bars]);

    // 4. Wait for symbol_error or timescale_update
    const msg = await this._waitFor(m => {
      if (m.m === 'symbol_error'   && m.p?.[0] === csId) return true;
      if (m.m === 'timescale_update' && m.p?.[0] === csId && m.p?.[1]?.[serId]) return true;
      return false;
    }, 20000);

    if (msg.m === 'symbol_error') {
      throw new Error(`Symbol not found: "${symbol}" → tried "${sym}". Use format like TVC:CAC40, NASDAQ:AAPL, BINANCE:BTCUSDT`);
    }

    const s = msg.p[1][serId];
    if (!s?.s?.length) throw new Error(`No series data for ${symbol} ${timeframe}`);

    return s.s.map(bar => {
      const [time, open, high, low, close, volume] = bar.v;
      return {
        time,
        date:   new Date(time * 1000).toISOString().split('T')[0],
        open:   open  ?? null,
        high:   high  ?? null,
        low:    low   ?? null,
        close:  close ?? null,
        volume: volume ?? 0,      // indices have no volume — returns 0
      };
    });
  }

  /**
   * Get a real-time quote for any symbol.
   * Returns the last bar as a quote snapshot.
   *
   * @param {string} symbol  e.g. "EURONEXT:CAC40"
   */
  async getQuote (symbol) {
    const bars  = await this.getOHLCV(symbol, 'D', 2);
    const last  = bars[bars.length - 1];
    const prev  = bars[bars.length - 2] ?? last;
    const chg   = parseFloat((last.close - prev.close).toFixed(4));
    const chgPct= parseFloat((chg / prev.close * 100).toFixed(2));
    return {
      symbol,
      price:     last.close,
      open:      last.open,
      high:      last.high,
      low:       last.low,
      volume:    last.volume,
      prevClose: prev.close,
      change:    chg,
      changePct: chgPct,
      date:      last.date,
      time:      last.time,
      isoTime:   new Date(last.time * 1000).toISOString(),
    };
  }

  /**
   * Fetch multiple timeframes for one symbol at once.
   *
   * @param {string}   symbol
   * @param {string[]} timeframes  e.g. ['D','240','W']
   * @param {number}   bars
   */
  async getMultiTimeframe (symbol, timeframes = ['D'], bars = 100) {
    const result = {};
    for (const tf of timeframes) {
      result[tf] = await this.getOHLCV(symbol, tf, bars);
    }
    return result;
  }
}

// ─── Symbol normalization ─────────────────────────────────────────────────────
// Maps common/shorthand symbols to the exact format TradingView WebSocket expects.
// Full list: pass the exchange prefix explicitly (e.g. NASDAQ:AAPL, BINANCE:BTCUSDT).

const SYMBOL_MAP = {
  // Indices
  'CAC40':        'TVC:CAC40',
  'EURONEXT:CAC40':'TVC:CAC40',
  'DAX':          'TVC:DAX',
  'FTSE100':      'TVC:UKX',
  'FTSE':         'TVC:UKX',
  'SPX':          'SP:SPX',
  'SP500':        'SP:SPX',
  'SP:SPX':       'SP:SPX',
  'NASDAQ100':    'NASDAQ:NDX',
  'NDX':          'NASDAQ:NDX',
  'DOW':          'TVC:DJI',
  'DJIA':         'TVC:DJI',
  'NIKKEI':       'TVC:NI225',
  'VIX':          'TVC:VIX',
  'INDEX:VIX':    'TVC:VIX',
  // Crypto — default to Binance
  'BTCUSD':       'BINANCE:BTCUSDT',
  'ETHUSD':       'BINANCE:ETHUSDT',
  'SOLUSD':       'BINANCE:SOLUSDT',
  // Common stocks (bare ticker → NASDAQ or NYSE)
  'AAPL':         'NASDAQ:AAPL',
  'TSLA':         'NASDAQ:TSLA',
  'NVDA':         'NASDAQ:NVDA',
  'MSFT':         'NASDAQ:MSFT',
  'AMZN':         'NASDAQ:AMZN',
  'GOOGL':        'NASDAQ:GOOGL',
  'META':         'NASDAQ:META',
};

function _normalizeSymbol (symbol) {
  const upper = symbol.toUpperCase();
  if (SYMBOL_MAP[upper]) return SYMBOL_MAP[upper];
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol];
  return symbol; // pass through — assume already in correct format
}

// ─── Resolution mapping ───────────────────────────────────────────────────────

const RES_MAP = {
  '1m':'1','3m':'3','5m':'5','10m':'10','15m':'15','30m':'30','45m':'45',
  '1h':'60','2h':'120','3h':'180','4h':'240','6h':'360','12h':'720',
  '1D':'D','1W':'W','1M':'M',
  // bare codes pass through
  '1':'1','5':'5','15':'15','60':'60','240':'240','D':'D','W':'W','M':'M',
};
function _tvResolution (tf) { return RES_MAP[tf] ?? tf; }

module.exports = { TVFeed };
