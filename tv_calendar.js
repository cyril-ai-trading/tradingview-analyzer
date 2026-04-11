/**
 * TradingView Calendar API
 * ─────────────────────────────────────────────────────────────────
 * 3 calendriers disponibles (aucune auth requise) :
 *
 *   1. Économique  — CPI, NFP, FOMC, taux, PIB, PMI...
 *   2. Earnings    — résultats d'entreprises (EPS, revenus)
 *   3. Dividendes  — ex-dates, montants, rendements
 */

'use strict';

const https = require('https');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEADERS = {
  'Origin':       'https://www.tradingview.com',
  'Referer':      'https://www.tradingview.com/',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Content-Type': 'application/json',
};

function get (url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: HEADERS }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`Parse error (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`)); }
      });
    }).on('error', reject);
  });
}

function post (url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`Parse error (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Date helpers
function toISO (d)   { return d instanceof Date ? d.toISOString() : new Date(d).toISOString(); }
function toUnix (d)  { return Math.floor((d instanceof Date ? d : new Date(d)).getTime() / 1000); }
function fromUnix(t) { return new Date(t * 1000).toISOString().split('T')[0]; }
function today ()    { return new Date(); }
function daysFromNow (n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

// ─── 1. Calendrier Économique ─────────────────────────────────────────────────

/**
 * Récupère les événements macro pour une plage de dates.
 *
 * @param {Object} opts
 * @param {Date|string} opts.from        Date de début (défaut: aujourd'hui)
 * @param {Date|string} opts.to          Date de fin   (défaut: +7 jours)
 * @param {string[]}    opts.countries   Codes pays ISO (défaut: ['US','EU','GB','JP','CN','CA','AU'])
 * @param {number}      opts.importance  1=low 2=medium 3=high (défaut: 2)
 *
 * @returns {Array<{ date, country, importance, title, previous, forecast, actual, period }>}
 *
 * @example
 * const events = await getEconomicCalendar({ countries: ['US'], importance: 3 });
 */
async function getEconomicCalendar ({
  from       = today(),
  to         = daysFromNow(7),
  countries  = ['US', 'EU', 'GB', 'JP', 'CN', 'CA', 'AU', 'FR', 'DE', 'CH'],
  importance = 2,
} = {}) {
  const params = new URLSearchParams({
    from:       toISO(from),
    to:         toISO(to),
    countries:  countries.join(','),
    importance: String(importance),
  });

  const data = await get(`https://economic-calendar.tradingview.com/events?${params}`);
  const list = data.result ?? data ?? [];

  return list
    .map(e => ({
      date:        e.date,
      dateLocal:   e.date?.slice(0, 10),
      timeLocal:   e.date?.slice(11, 16),
      country:     e.country,
      importance:  e.importance,          // 1 low / 2 medium / 3 high
      importanceLabel: ({ 1: '🟡 Low', 2: '🟠 Medium', 3: '🔴 High' })[e.importance] ?? '',
      title:       e.title,
      indicator:   e.indicator,
      period:      e.period,
      previous:    e.previous,
      forecast:    e.forecast,
      actual:      e.actual,
      source:      e.source,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ─── 2. Calendrier Earnings ───────────────────────────────────────────────────

/**
 * Résultats d'entreprises à venir ou passés.
 *
 * @param {Object} opts
 * @param {Date|string} opts.from     (défaut: aujourd'hui)
 * @param {Date|string} opts.to       (défaut: +7 jours)
 * @param {string[]}    opts.markets  ['america','france','europe',...] (défaut: all)
 * @param {number}      opts.limit
 *
 * @returns {Array<{ symbol, name, date, time, epsEstimate, epsActual, epsSurprise, revenueEstimate, marketCap, quarter }>}
 */
async function getEarningsCalendar ({
  from    = today(),
  to      = daysFromNow(7),
  markets = [],
  limit   = 50,
} = {}) {
  const fromTs = toUnix(from);
  const toTs   = toUnix(to);

  const body = {
    filter: [{
      left:      'earnings_release_date,earnings_release_next_date',
      operation: 'in_range',
      right:     [fromTs, toTs],
    }],
    columns: [
      'name', 'description',
      'earnings_release_next_date', 'earnings_release_date',
      'earnings_release_next_time', 'earnings_release_time',
      'earnings_per_share_forecast_next_fq', 'earnings_per_share_fq',
      'eps_surprise_fq', 'eps_surprise_percent_fq',
      'revenue_forecast_next_fq', 'revenue_fq',
      'revenue_surprise_fq', 'revenue_surprise_percent_fq',
      'market_cap_basic',
      'earnings_publication_type_next_fq',
      'fundamental_currency_code',
    ],
    options: { lang: 'en' },
    range:   [0, limit],
    ...(markets.length ? { markets } : {}),
  };

  const resp = await post(
    'https://scanner.tradingview.com/global/scan?label-product=calendar-earnings',
    body
  );

  return (resp.data ?? []).map(row => {
    const d = row.d;
    const releaseDate = d[2] ?? d[3];
    const releaseTime = d[4] ?? d[5];
    return {
      symbol:           row.s,
      name:             d[0],
      company:          d[1],
      date:             releaseDate ? fromUnix(releaseDate) : null,
      time:             releaseTime ?? '--',          // 'BMO' | 'AMC' | '--'
      epsEstimate:      d[6],
      epsActual:        d[7],
      epsSurprise:      d[8],
      epsSurprisePct:   d[9],
      revenueEstimate:  d[10],
      revenueActual:    d[11],
      revenueSurprise:  d[12],
      revenueSurprisePct: d[13],
      marketCap:        d[14],
      quarter:          d[15],
      currency:         d[16],
    };
  }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

// ─── 3. Calendrier Dividendes ─────────────────────────────────────────────────

/**
 * Dividendes à venir (ex-dates).
 *
 * @param {Object} opts
 * @param {Date|string} opts.from
 * @param {Date|string} opts.to
 * @param {string[]}    opts.markets
 * @param {number}      opts.limit
 *
 * @returns {Array<{ symbol, name, exDate, payDate, amount, yield, currency }>}
 */
async function getDividendCalendar ({
  from    = today(),
  to      = daysFromNow(30),
  markets = [],
  limit   = 50,
} = {}) {
  const fromTs = toUnix(from);
  const toTs   = toUnix(to);

  const body = {
    filter: [{
      left:      'dividend_ex_date_recent,dividend_ex_date_upcoming',
      operation: 'in_range',
      right:     [fromTs, toTs],
    }],
    columns: [
      'name', 'description',
      'dividend_ex_date_upcoming', 'dividend_ex_date_recent',
      'dividend_payment_date_upcoming', 'dividend_payment_date_recent',
      'dividend_amount_upcoming', 'dividend_amount_recent',
      'dividends_yield',
      'fundamental_currency_code',
      'market_cap_basic',
    ],
    options: { lang: 'en' },
    range:   [0, limit],
    ...(markets.length ? { markets } : {}),
  };

  const resp = await post(
    'https://scanner.tradingview.com/global/scan?label-product=calendar-dividends',
    body
  );

  return (resp.data ?? []).map(row => {
    const d = row.d;
    const exDate  = d[2] ?? d[3];
    const payDate = d[4] ?? d[5];
    const amount  = d[6] ?? d[7];
    return {
      symbol:    row.s,
      name:      d[0],
      company:   d[1],
      exDate:    exDate  ? fromUnix(exDate)  : null,
      payDate:   payDate ? fromUnix(payDate) : null,
      amount:    amount,
      yield:     d[8],      // %
      currency:  d[9],
      marketCap: d[10],
    };
  }).sort((a, b) => (a.exDate ?? '').localeCompare(b.exDate ?? ''));
}

// ─── Pretty printers ──────────────────────────────────────────────────────────

function printEconomicCalendar (events, title = 'Calendrier Économique') {
  if (!events.length) { console.log('  Aucun événement.'); return; }
  console.log(`\n  ${title} (${events.length} événements)\n`);
  console.log('  Date        Heure  Pays  Importance       Événement                          Préc.     Prévu     Réel');
  console.log('  ' + '─'.repeat(112));

  for (const e of events) {
    const date = (e.dateLocal ?? '').padEnd(12);
    const time = (e.timeLocal ?? '').padEnd(7);
    const ctry = (e.country ?? '').padEnd(6);
    const imp  = e.importanceLabel.padEnd(17);
    const name = (e.title ?? '').slice(0, 34).padEnd(35);
    const prev = (e.previous ?? '--').toString().padStart(9);
    const fore = (e.forecast ?? '--').toString().padStart(9);
    const act  = (e.actual   ?? '--').toString().padStart(9);
    console.log(`  ${date}${time}${ctry}${imp}${name}${prev}${fore}${act}`);
  }
  console.log();
}

function printEarningsCalendar (events, title = 'Calendrier Earnings') {
  if (!events.length) { console.log('  Aucun résultat.'); return; }
  console.log(`\n  ${title} (${events.length} sociétés)\n`);
  console.log('  Date        Heure  Symbol                  Société                       EPS Est.   Cap(B)');
  console.log('  ' + '─'.repeat(100));

  for (const e of events) {
    const date = (e.date  ?? '').padEnd(12);
    const time = String(e.time ?? '--').padEnd(7);
    const sym  = (e.symbol ?? '').padEnd(24);
    const co   = (e.company ?? '').slice(0, 28).padEnd(30);
    const eps  = e.epsEstimate != null ? e.epsEstimate.toFixed(2).padStart(9) : '       --';
    const cap  = e.marketCap   != null ? (e.marketCap / 1e9).toFixed(1).padStart(8) : '      --';
    console.log(`  ${date}${time}${sym}${co}${eps}${cap}`);
  }
  console.log();
}

function printDividendCalendar (events, title = 'Calendrier Dividendes') {
  if (!events.length) { console.log('  Aucun dividende.'); return; }
  console.log(`\n  ${title} (${events.length} versements)\n`);
  console.log('  Ex-Date     Pay-Date    Symbol                  Société                  Montant  Rend.%   Cap(B)');
  console.log('  ' + '─'.repeat(102));

  for (const e of events) {
    const exd  = (e.exDate  ?? '').padEnd(12);
    const payd = (e.payDate ?? '').padEnd(12);
    const sym  = (e.symbol  ?? '').padEnd(24);
    const co   = (e.company ?? '').slice(0, 23).padEnd(25);
    const amt  = e.amount   != null ? `${e.amount.toFixed(4)} ${e.currency ?? ''}`.padStart(10) : '        --';
    const yld  = e.yield    != null ? `${e.yield.toFixed(2)}%`.padStart(8)  : '      --';
    const cap  = e.marketCap != null ? (e.marketCap / 1e9).toFixed(1).padStart(8) : '      --';
    console.log(`  ${exd}${payd}${sym}${co}${amt}${yld}${cap}`);
  }
  console.log();
}

module.exports = {
  getEconomicCalendar,
  getEarningsCalendar,
  getDividendCalendar,
  printEconomicCalendar,
  printEarningsCalendar,
  printDividendCalendar,
};
