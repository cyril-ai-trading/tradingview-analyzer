/**
 * TradingView Screener API
 * ──────────────────────────────────────────────────────────────────
 * Accès direct à l'API scanner de TradingView (pas d'auth requise).
 * Permet de filtrer n'importe quel marché par RSI, capitalisation,
 * EMA, MACD, volume, secteur, P/E, dividendes, etc.
 *
 * Marchés disponibles:
 *   america, france, europe, crypto, forex, futures,
 *   germany, uk, italy, spain, brazil, australia, canada, india...
 */

'use strict';

const https = require('https');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function post (url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin':         'https://www.tradingview.com',
        'Referer':        'https://www.tradingview.com/',
      },
    };
    const req = https.request(url, opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`Parse error (HTTP ${res.statusCode}): ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Market → endpoint mapping ────────────────────────────────────────────────

const MARKETS = {
  // Stocks
  'us':          'america',
  'usa':         'america',
  'america':     'america',
  'france':      'france',
  'fr':          'france',
  'europe':      'europe',
  'eu':          'europe',
  'germany':     'germany',
  'de':          'germany',
  'uk':          'uk',
  'gb':          'uk',
  'italy':       'italy',
  'spain':       'spain',
  'netherlands': 'netherlands',
  'switzerland': 'switzerland',
  'canada':      'canada',
  'ca':          'canada',
  'australia':   'australia',
  'au':          'australia',
  'india':       'india',
  'japan':       'japan',
  'brazil':      'brazil',
  'china':       'china',
  // Other asset classes
  'crypto':      'crypto',
  'forex':       'forex',
  'futures':     'futures',
  'cfd':         'cfd',
};

function marketUrl (market) {
  const m = MARKETS[market.toLowerCase()] ?? market.toLowerCase();
  return `https://scanner.tradingview.com/${m}/scan`;
}

// ─── Available columns (indicators & fundamentals) ────────────────────────────

const COLUMNS = {
  // Price
  price:               'close',
  close:               'close',
  open:                'open',
  high:                'high',
  low:                 'low',
  change:              'change',
  changePct:           'change',
  changeAbs:           'change_abs',
  volume:              'volume',
  volumeRelative:      'relative_volume_10d_calc',
  avgVolume10:         'average_volume_10d_calc',
  avgVolume30:         'average_volume_30d_calc',
  avgVolume60:         'average_volume_60d_calc',
  preMarketChange:     'premarket_change',
  afterHoursChange:    'postmarket_change',

  // 52-week & price position
  high52w:             'price_52_week_high',
  low52w:              'price_52_week_low',
  pct52wHigh:          'High.All',        // % from 52w high
  pct52wLow:           'Low.All',         // % from 52w low
  gap:                 'gap',             // gap % from previous close

  // Technical indicators — momentum
  rsi:                 'RSI',
  rsi14:               'RSI',
  rsi1:                'RSI[1]',
  macd:                'MACD.macd',
  macdSignal:          'MACD.signal',
  macdHist:            'MACD.hist',
  stochK:              'Stoch.K',
  stochD:              'Stoch.D',
  stochRsiK:           'Stoch.RSI.K',
  cci:                 'CCI20',
  williamsR:           'W.R',
  mfi:                 'MFI',
  roc:                 'ROC',
  roc1:                'ROC[1]',
  momentum:            'Mom',
  ultimateOsc:         'UO',

  // Technical indicators — trend/MA
  ema9:                'EMA9',
  ema20:               'EMA20',
  ema50:               'EMA50',
  ema100:              'EMA100',
  ema200:              'EMA200',
  sma5:                'SMA5',
  sma10:               'SMA10',
  sma20:               'SMA20',
  sma50:               'SMA50',
  sma100:              'SMA100',
  sma200:              'SMA200',
  vwap:                'VWAP',
  hullMa9:             'HullMA9',
  ichimokuBase:        'Ichimoku.BLine',
  ichimokuConv:        'Ichimoku.CLine',
  priceSma20Pct:       'close_to_sma20_ratio',   // price / SMA20 - 1
  priceSma50Pct:       'close_to_sma50_ratio',
  priceSma200Pct:      'close_to_sma200_ratio',

  // Technical indicators — volatility
  bbUpper:             'BB.upper',
  bbLower:             'BB.lower',
  bbWidth:             'BB.width',
  bbPercent:           'BB.percent_b',
  atr:                 'ATR',
  atr14:               'ATR',
  adx:                 'ADX',
  adx14:               'ADX',
  adxpDI:              'ADX+DI',
  adxmDI:              'ADX-DI',
  volatility:          'Volatility.D',
  volatilityW:         'Volatility.W',
  volatilityM:         'Volatility.M',

  // Recommendation (TradingView signal)
  tvRating:            'Recommend.All',        // -1 to 1  (Strong Sell → Strong Buy)
  tvRatingMA:          'Recommend.MA',
  tvRatingOsc:         'Recommend.Other',

  // Fundamentals — valuation
  marketCap:           'market_cap_basic',
  enterpriseValue:     'enterprise_value_basic',
  pe:                  'price_earnings_ttm',
  forwardPe:           'price_earnings_fwd',
  peg:                 'price_earnings_growth_ttm',
  ps:                  'price_sales_ratio',
  pb:                  'price_book_ratio',
  pcf:                 'price_cash_flow_ratio',
  evEbitda:            'ev_ebitda_ttm',
  evEbit:              'ev_ebit_ttm',
  eps:                 'earnings_per_share_basic_ttm',
  epsForward:          'earnings_per_share_fwd',
  epsGrowthTtm:        'earnings_per_share_basic_yoy_growth',
  revenueGrowthTtm:    'revenue_per_employee',   // proxy

  // Fundamentals — profitability
  grossMargin:         'gross_margin',
  operatingMargin:     'oper_income',
  netMargin:           'net_margin',
  roe:                 'return_on_equity',
  roa:                 'return_on_assets',
  roic:                'return_on_invested_capital',

  // Fundamentals — dividends & earnings
  dividend:            'dividends_yield',
  dividendYield:       'dividends_yield',
  payoutRatio:         'payout_ratio',
  earningsDate:        'earnings_release_next_date',

  // Fundamentals — size & structure
  beta:                'beta_1_year',
  float:               'float_shares_outstanding',
  sharesOut:           'total_shares_outstanding',
  shortFloat:          'short_ratio',
  debt:                'total_debt_mrq',
  cash:                'cash_n_short_term_investments_fy',
  currentRatio:        'current_ratio_mrq',
  debtEquity:          'debt_to_equity_mrq',

  // Classification
  sector:              'sector',
  industry:            'industry',
  name:                'name',
  description:         'description',
  exchange:            'exchange',
  country:             'country',
  type:                'type',
  subtype:             'subtype',
  ipoDate:             'ipo_date',
};

function col (key) {
  return COLUMNS[key] ?? key; // pass through raw column names too
}

// ─── Operations ───────────────────────────────────────────────────────────────

const OPS = {
  '>':        'greater',
  '<':        'less',
  '>=':       'greater_equal',
  '<=':       'less_equal',
  '=':        'equal',
  '==':       'equal',
  '!=':       'not_equal',
  'between':  'in_range',
  'in':       'in_range',
  'match':    'match',
  'contains': 'match',
};

function op (o) { return OPS[o] ?? o; }

// ─── TVScreener class ─────────────────────────────────────────────────────────

class TVScreener {
  /**
   * @param {string} market  'america' | 'france' | 'crypto' | 'forex' | ...
   */
  constructor (market = 'america') {
    this._market  = market;
    this._filters = [];
    this._columns = ['name', 'description', 'close', 'change', 'volume',
                     'market_cap_basic', 'RSI', 'exchange', 'sector'];
    this._sort    = { sortBy: 'market_cap_basic', sortOrder: 'desc' };
    this._range   = [0, 50];
  }

  // ── Builder API ─────────────────────────────────────────────────────────────

  /** Set market */
  market (m) { this._market = m; return this; }

  /** Number of results */
  limit (n) { this._range = [0, n]; return this; }

  /** Columns to return */
  select (...cols) {
    this._columns = ['name', 'description', ...cols.map(col)];
    return this;
  }

  /** Sort results */
  sortBy (column, order = 'desc') {
    this._sort = { sortBy: col(column), sortOrder: order };
    return this;
  }

  /**
   * Add a filter condition.
   *
   * filter('rsi', '>', 50)
   * filter('rsi', 'between', 40, 60)
   * filter('sector', 'match', 'Technology')
   */
  filter (column, operation, value, value2 = undefined) {
    const f = { left: col(column), operation: op(operation), right: value };
    if (value2 !== undefined) f.right = [value, value2];
    this._filters.push(f);
    return this;
  }

  /** Execute the screen */
  async run () {
    const body = {
      filter:  this._filters,
      columns: this._columns,
      sort:    this._sort,
      range:   this._range,
      options: { lang: 'en' },
    };

    const url  = marketUrl(this._market);
    const resp = await post(url, body);

    if (!resp.data) return [];

    // Reverse lookup: TV column name → friendly key (prefer exact key match)
    const reverseMap = {};
    for (const [k, v] of Object.entries(COLUMNS)) {
      if (!reverseMap[v]) reverseMap[v] = k; // first match wins
    }
    // Explicit overrides to ensure correct friendly names
    reverseMap['close']                    = 'close';
    reverseMap['change']                   = 'changePct';
    reverseMap['market_cap_basic']         = 'marketCap';
    reverseMap['RSI']                      = 'rsi';
    reverseMap['EMA9']                     = 'ema9';
    reverseMap['EMA20']                    = 'ema20';
    reverseMap['EMA50']                    = 'ema50';
    reverseMap['EMA100']                   = 'ema100';
    reverseMap['EMA200']                   = 'ema200';
    reverseMap['SMA5']                     = 'sma5';
    reverseMap['SMA10']                    = 'sma10';
    reverseMap['SMA20']                    = 'sma20';
    reverseMap['SMA50']                    = 'sma50';
    reverseMap['SMA100']                   = 'sma100';
    reverseMap['SMA200']                   = 'sma200';
    reverseMap['ATR']                      = 'atr';
    reverseMap['ADX']                      = 'adx';
    reverseMap['BB.upper']                 = 'bbUpper';
    reverseMap['BB.lower']                 = 'bbLower';
    reverseMap['BB.width']                 = 'bbWidth';
    reverseMap['Recommend.All']            = 'tvRating';
    reverseMap['price_52_week_high']       = 'high52w';
    reverseMap['price_52_week_low']        = 'low52w';
    reverseMap['beta_1_year']              = 'beta';
    reverseMap['dividends_yield']          = 'dividendYield';
    reverseMap['price_earnings_ttm']       = 'pe';
    reverseMap['earnings_per_share_basic_ttm'] = 'eps';
    reverseMap['relative_volume_10d_calc'] = 'volumeRelative';
    reverseMap['average_volume_10d_calc']  = 'avgVolume10';

    return resp.data.map(row => {
      const out = {};
      this._columns.forEach((c, i) => {
        const friendly = reverseMap[c] ?? c;
        out[friendly] = row.d[i];
      });
      out._symbol = `${row.s}`;
      return out;
    });
  }

  // ── Preset screens ───────────────────────────────────────────────────────────

  /** RSI oversold — bons candidats à un rebond */
  static async oversold (market = 'america', rsiMax = 35, limit = 20) {
    return new TVScreener(market)
      .filter('rsi', '<', rsiMax)
      .filter('volume', '>', 500000)
      .filter('marketCap', '>', 1e9)
      .select('close', 'change', 'volume', 'rsi', 'ema50', 'ema200', 'marketCap', 'sector', 'beta')
      .sortBy('marketCap', 'desc')
      .limit(limit)
      .run();
  }

  /** RSI overbought — potentiels shorts ou prises de profit */
  static async overbought (market = 'america', rsiMin = 70, limit = 20) {
    return new TVScreener(market)
      .filter('rsi', '>', rsiMin)
      .filter('volume', '>', 500000)
      .filter('marketCap', '>', 1e9)
      .select('close', 'change', 'volume', 'rsi', 'ema50', 'ema200', 'marketCap', 'sector', 'beta')
      .sortBy('marketCap', 'desc')
      .limit(limit)
      .run();
  }

  /** Cassure haussière : prix > EMA200, RSI entre 50-70, volume élevé */
  static async bullishBreakout (market = 'america', limit = 20) {
    return new TVScreener(market)
      .filter('rsi', 'between', 50, 70)
      .filter('close', '>', 'EMA200')  // price above EMA200
      .filter('volumeRelative', '>', 1.5)
      .filter('marketCap', '>', 2e9)
      .select('close', 'change', 'volume', 'volumeRelative', 'rsi', 'ema50', 'ema200', 'atr', 'marketCap', 'sector')
      .sortBy('volumeRelative', 'desc')
      .limit(limit)
      .run();
  }

  /** Golden cross : EMA50 récemment passé au-dessus de EMA200 */
  static async goldenCross (market = 'america', limit = 20) {
    return new TVScreener(market)
      .filter('ema50', '>', 'SMA200')
      .filter('close', '>', 'EMA50')
      .filter('rsi', 'between', 45, 75)
      .filter('marketCap', '>', 1e9)
      .select('close', 'change', 'volume', 'rsi', 'ema50', 'sma200', 'adx', 'marketCap', 'sector')
      .sortBy('marketCap', 'desc')
      .limit(limit)
      .run();
  }

  /** Earnings play — candidats pour stratégies options sur earnings */
  static async earningsPlay (market = 'america', daysAhead = 20, limit = 30) {
    return new TVScreener(market)
      .filter('marketCap', '>', 5e9)
      .filter('volume', '>', 1e6)
      .filter('close', 'between', 20, 500)
      .select('close', 'change', 'volume', 'avgVolume10', 'rsi', 'ema50', 'beta',
              'marketCap', 'pe', 'eps', 'earningsDate', 'sector', 'volatilityM')
      .sortBy('marketCap', 'desc')
      .limit(limit)
      .run();
  }

  /** Momentum fort : RSI élevé, prix proche des plus hauts, ADX fort */
  static async strongMomentum (market = 'america', limit = 20) {
    return new TVScreener(market)
      .filter('rsi', '>', 60)
      .filter('adx', '>', 25)
      .filter('close', '>', 'EMA20')
      .filter('volumeRelative', '>', 1.2)
      .filter('marketCap', '>', 1e9)
      .select('close', 'change', 'volume', 'volumeRelative', 'rsi', 'adx', 'ema20', 'ema50', 'marketCap', 'sector')
      .sortBy('adx', 'desc')
      .limit(limit)
      .run();
  }

  /** Value — faible PE, PB, dividende élevé */
  static async value (market = 'america', limit = 20) {
    return new TVScreener(market)
      .filter('pe', 'between', 5, 18)
      .filter('pb', '<', 2)
      .filter('marketCap', '>', 5e9)
      .filter('dividendYield', '>', 1)
      .select('close', 'change', 'pe', 'pb', 'eps', 'dividendYield', 'roe', 'marketCap', 'sector', 'rsi')
      .sortBy('dividendYield', 'desc')
      .limit(limit)
      .run();
  }

  /** Volatilité élevée — Bollinger Width large, fort ATR */
  static async highVolatility (market = 'america', limit = 20) {
    return new TVScreener(market)
      .filter('bbWidth', '>', 0.1)
      .filter('volume', '>', 500000)
      .filter('marketCap', '>', 1e9)
      .select('close', 'change', 'volume', 'rsi', 'atr', 'bbUpper', 'bbLower', 'bbWidth', 'beta', 'marketCap', 'sector')
      .sortBy('bbWidth', 'desc')
      .limit(limit)
      .run();
  }

  /** Custom — builder libre avec filtres tableau */
  static async custom (market, filters = [], columns = [], sortCol = 'marketCap', limit = 30) {
    const s = new TVScreener(market);
    for (const [c, o, v, v2] of filters) s.filter(c, o, v, v2);
    if (columns.length) s.select(...columns);
    s.sortBy(sortCol, 'desc').limit(limit);
    return s.run();
  }
}

// ─── Quick helpers ────────────────────────────────────────────────────────────

/**
 * One-liner: find assets matching simple criteria.
 *
 * @example
 * screen('france', { rsi: '<40', marketCap: '>1e9' }, 20)
 * screen('crypto', { rsi: '>70' }, 15)
 */
async function screen (market, criteria = {}, limit = 30, columns = []) {
  const s = new TVScreener(market).limit(limit);

  for (const [key, expr] of Object.entries(criteria)) {
    const match = String(expr).match(/^([><=!]+)\s*(.+)$/);
    if (match) {
      const [, operator, val] = match;
      const num = parseFloat(val);
      s.filter(key, operator, isNaN(num) ? val : num);
    }
  }

  const defaultCols = ['close', 'change', 'volume', 'rsi', 'marketCap', 'sector', 'description'];
  s.select(...(columns.length ? columns : defaultCols));
  s.sortBy('marketCap', 'desc');

  return s.run();
}

// ─── CLI helper ───────────────────────────────────────────────────────────────

function fmtNum (n, dec = 2, width = 8) {
  if (n == null) return '--'.padStart(width);
  return n.toFixed(dec).padStart(width);
}
function fmtPct (n, width = 7) {
  if (n == null) return '--'.padStart(width);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`.padStart(width);
}
function fmtCap (n) {
  if (n == null) return '    --';
  if (n >= 1e12) return `${(n/1e12).toFixed(1)}T`.padStart(6);
  if (n >= 1e9)  return `${(n/1e9).toFixed(1)}B`.padStart(6);
  if (n >= 1e6)  return `${(n/1e6).toFixed(0)}M`.padStart(6);
  return String(n).padStart(6);
}
function fmtVol (n) {
  if (n == null) return '    --';
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}G`.padStart(6);
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`.padStart(6);
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`.padStart(6);
  return String(n).padStart(6);
}

function printScreen (results, title = '') {
  if (!results.length) { console.log('  No results.'); return; }
  if (title) console.log(`\n  ${title} (${results.length} results)\n`);

  // Detect which extra columns are present
  const sample = results[0];
  const hasEma50  = sample.ema50  != null;
  const hasEma200 = sample.ema200 != null;
  const hasAdx    = sample.adx    != null;
  const hasBeta   = sample.beta   != null;
  const hasPe     = sample.pe     != null;
  const hasVolRel = sample.volumeRelative != null;
  const hasAtr    = sample.atr    != null;
  const hasDivYld = sample.dividendYield  != null;

  // Build dynamic header
  let header = '  ' + 'Symbol'.padEnd(22) + 'Name'.padEnd(24) + 'Price'.padStart(9) + ' Chg%'.padStart(8) + ' RSI'.padStart(6) + ' Cap'.padStart(7) + ' Vol'.padStart(7);
  if (hasEma50)  header += ' EMA50'.padStart(9);
  if (hasEma200) header += 'EMA200'.padStart(9);
  if (hasAdx)    header += ' ADX'.padStart(6);
  if (hasBeta)   header += ' Beta'.padStart(6);
  if (hasPe)     header += '   P/E'.padStart(7);
  if (hasVolRel) header += ' VolRel'.padStart(8);
  if (hasAtr)    header += '  ATR'.padStart(7);
  if (hasDivYld) header += ' Div%'.padStart(6);
  header += '  Sector';

  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  for (const r of results) {
    const sym  = (r._symbol ?? '').slice(0, 21).padEnd(22);
    const name = (r.description ?? r.name ?? '').slice(0, 22).padEnd(24);
    const px   = fmtNum(r.close ?? r.price, 2, 9);
    const chg  = fmtPct(r.changePct ?? r.change, 8);
    const rsi  = fmtNum(r.rsi, 1, 6);
    const cap  = fmtCap(r.marketCap).padStart(7);
    const vol  = fmtVol(r.volume).padStart(7);

    let row = `  ${sym}${name}${px}${chg}${rsi}${cap}${vol}`;
    if (hasEma50)  row += fmtNum(r.ema50, 2, 9);
    if (hasEma200) row += fmtNum(r.ema200, 2, 9);
    if (hasAdx)    row += fmtNum(r.adx, 1, 6);
    if (hasBeta)   row += fmtNum(r.beta, 2, 6);
    if (hasPe)     row += fmtNum(r.pe, 1, 7);
    if (hasVolRel) row += fmtNum(r.volumeRelative, 2, 8);
    if (hasAtr)    row += fmtNum(r.atr, 2, 7);
    if (hasDivYld) row += fmtNum(r.dividendYield, 2, 6);
    row += '  ' + (r.sector ?? '').slice(0, 20);

    console.log(row);
  }
  console.log();
}

/** Affiche les données brutes d'un seul résultat de façon lisible */
function printDetail (r) {
  console.log(`\n  ── ${r._symbol} — ${r.description ?? r.name ?? ''} ──`);
  const fields = Object.entries(r).filter(([k]) => k !== '_symbol');
  for (const [k, v] of fields) {
    if (v == null) continue;
    const val = typeof v === 'number'
      ? (Math.abs(v) >= 1e6 ? fmtCap(v) : v.toFixed(4))
      : String(v);
    console.log(`    ${k.padEnd(20)} ${val}`);
  }
  console.log();
}

module.exports = { TVScreener, screen, printScreen, printDetail, COLUMNS, fmtNum, fmtPct, fmtCap, fmtVol };
