'use strict';
/**
 * options_chain.js — Chaîne d'options via CBOE (données publiques, Greeks inclus)
 *
 * Source : https://cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json
 * Données : bid, ask, IV, delta, gamma, vega, theta, rho, OI, volume (delayed ~15min)
 * Greeks : fournis directement par CBOE (pas besoin de Black-Scholes)
 *
 * Usage :
 *   const { getOptionsChain, printOptionsChain } = require('./options_chain');
 *   const data = await getOptionsChain('AAPL', { expiry: '2026-05-16', strikes: 10 });
 *   printOptionsChain(data);
 */

const https = require('https');

// ─── Black-Scholes (garde pour calculs complémentaires si IV manquant) ─────────

function normalCDF(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x) / Math.sqrt(2));
  const y = 1 - (((((a[4]*t + a[3])*t + a[2])*t + a[1])*t + a[0])*t) * Math.exp(-x*x/2);
  return 0.5 * (1 + sign * y);
}

function blackScholes(S, K, T, r = 0.045, sigma, type = 'call') {
  if (!S || !K || !T || !sigma || T <= 0 || sigma <= 0) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*sqrtT);
  const d2 = d1 - sigma*sqrtT;
  const Nd1 = normalCDF(d1), Nd2 = normalCDF(d2);
  const Nd1n = normalCDF(-d1), Nd2n = normalCDF(-d2);
  const phi  = Math.exp(-0.5*d1*d1) / Math.sqrt(2*Math.PI);
  const disc = Math.exp(-r*T);

  const price = type === 'call'
    ? S*Nd1 - K*disc*Nd2
    : K*disc*Nd2n - S*Nd1n;

  return {
    price: +price.toFixed(4),
    delta: +(type === 'call' ? Nd1 : Nd1 - 1).toFixed(4),
    gamma: +(phi / (S * sigma * sqrtT)).toFixed(6),
    vega:  +(S * phi * sqrtT / 100).toFixed(4),
    theta: +(type === 'call'
      ? (-(S*phi*sigma)/(2*sqrtT) - r*K*disc*Nd2) / 365
      : (-(S*phi*sigma)/(2*sqrtT) + r*K*disc*Nd2n) / 365).toFixed(4),
    rho:   +(type === 'call'
      ? K*T*disc*Nd2/100
      : -K*T*disc*Nd2n/100).toFixed(4),
  };
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
        'Accept':      'application/json',
        'Referer':     'https://www.cboe.com/',
      },
      timeout: 20000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Option name parser ────────────────────────────────────────────────────────
// Format CBOE : {SYM}{YY}{MM}{DD}{C|P}{8-digit-strike * 1000}
// Ex: AAPL260516C00260000 → AAPL, 2026-05-16, Call, strike $260

function parseOptionName(name) {
  const m = name.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, sym, yy, mm, dd, cp, strikePart] = m;
  return {
    symbol: sym,
    expiry: `20${yy}-${mm}-${dd}`,
    type:   cp === 'C' ? 'call' : 'put',
    strike: parseInt(strikePart) / 1000,
  };
}

// ─── Main fetch ────────────────────────────────────────────────────────────────

/**
 * Fetches the complete options chain for a ticker from CBOE.
 *
 * @param {string} ticker         Ex: 'AAPL', 'SPY', 'TSLA'
 * @param {Object} [opts]
 * @param {string} [opts.expiry]  Filter to specific expiry 'YYYY-MM-DD' (null = all)
 * @param {number} [opts.strikes] Number of strikes around ATM to keep (0 = all)
 * @returns {Promise<Object>}     Structured options chain
 */
async function getOptionsChain(ticker, opts = {}) {
  const { expiry = null, strikes = 10 } = opts;
  const sym = ticker.toUpperCase().replace(/[^A-Z]/g, '');

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`;
  const raw = await httpsGet(url);
  const json = JSON.parse(raw);
  const d = json.data;

  const spotPrice = d.current_price ?? d.close;
  const iv30      = d.iv30;

  // Parse all options
  const allOptions = (d.options ?? []).map(o => {
    const parsed = parseOptionName(o.option);
    if (!parsed) return null;
    return {
      expiry:       parsed.expiry,
      type:         parsed.type,
      strike:       parsed.strike,
      bid:          o.bid ?? 0,
      ask:          o.ask ?? 0,
      mid:          o.bid != null && o.ask != null ? +((o.bid + o.ask) / 2).toFixed(3) : null,
      last:         o.last_trade_price ?? null,
      volume:       o.volume ?? 0,
      openInterest: o.open_interest ?? 0,
      iv:           o.iv != null ? o.iv / 100 : null,  // CBOE gives IV as %, convert to decimal
      delta:        o.delta ?? null,
      gamma:        o.gamma ?? null,
      vega:         o.vega ?? null,
      theta:        o.theta ?? null,
      rho:          o.rho ?? null,
      theo:         o.theo ?? null,
      itm:          parsed.type === 'call' ? parsed.strike < spotPrice : parsed.strike > spotPrice,
    };
  }).filter(Boolean);

  // Get unique sorted expiries
  const expiries = [...new Set(allOptions.map(o => o.expiry))].sort();

  // Filter by expiry if requested
  const targetExpiries = expiry ? [expiry] : expiries;

  // Build chain by expiry
  const chain = {};
  for (const exp of targetExpiries) {
    const expOpts = allOptions.filter(o => o.expiry === exp);
    if (!expOpts.length) continue;

    const calls = expOpts.filter(o => o.type === 'call').sort((a, b) => a.strike - b.strike);
    const puts  = expOpts.filter(o => o.type === 'put').sort((a, b) => a.strike - b.strike);

    // Find ATM strike (closest to spot)
    const allStrikes = [...new Set(expOpts.map(o => o.strike))].sort((a, b) => a - b);
    const atmStrike  = allStrikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, allStrikes[0]);

    // Filter N strikes around ATM
    let filteredCalls = calls, filteredPuts = puts;
    if (strikes > 0) {
      const atmIdx   = allStrikes.indexOf(atmStrike);
      const minStrike = allStrikes[Math.max(0, atmIdx - strikes)] ?? 0;
      const maxStrike = allStrikes[Math.min(allStrikes.length-1, atmIdx + strikes)] ?? Infinity;
      filteredCalls = calls.filter(o => o.strike >= minStrike && o.strike <= maxStrike);
      filteredPuts  = puts.filter(o => o.strike >= minStrike && o.strike <= maxStrike);
    }

    // Compute implied move from ATM straddle
    const atmCall = calls.find(o => o.strike === atmStrike);
    const atmPut  = puts.find(o => o.strike === atmStrike);
    const straddleCost  = (atmCall?.mid ?? 0) + (atmPut?.mid ?? 0);
    const impliedMove   = spotPrice > 0 ? straddleCost / spotPrice : null;

    chain[exp] = {
      calls:        filteredCalls,
      puts:         filteredPuts,
      atmStrike,
      straddleCost: +straddleCost.toFixed(2),
      impliedMove:  impliedMove != null ? +impliedMove.toFixed(4) : null,
    };
  }

  return { ticker: sym, spotPrice, iv30, expiries, chain };
}

// ─── Earnings play analysis ────────────────────────────────────────────────────

/**
 * Analyse les stratégies earnings play pour une expiry donnée.
 * Retourne le coût du straddle, l'iron condor suggéré, les breakevens.
 */
function analyzeEarningsOptions(data, expiry) {
  const exp = data.chain[expiry];
  if (!exp) return { error: `Expiry ${expiry} not found` };

  const { calls, puts, atmStrike, straddleCost, impliedMove } = exp;
  const spot = data.spotPrice;

  // Straddle
  const straddle = {
    strike:     atmStrike,
    cost:       straddleCost,
    impliedMove: impliedMove != null ? `±${(impliedMove*100).toFixed(1)}%` : '--',
    breakevenUp:   +(atmStrike + straddleCost).toFixed(2),
    breakevenDown: +(atmStrike - straddleCost).toFixed(2),
  };

  // Iron Condor suggestion: sell 1 SD wings, buy 2 SD protection
  const oneSd   = impliedMove ? spot * impliedMove : null;
  const twoSd   = oneSd ? oneSd * 2 : null;
  const allStrikes = [...new Set([...calls, ...puts].map(o => o.strike))].sort((a,b) => a-b);

  const findClosest = (target) => allStrikes.reduce((p, c) =>
    Math.abs(c - target) < Math.abs(p - target) ? c : p, allStrikes[0]);

  let ironCondor = null;
  if (oneSd) {
    const shortCallStrike = findClosest(spot + oneSd);
    const shortPutStrike  = findClosest(spot - oneSd);
    const longCallStrike  = twoSd ? findClosest(spot + twoSd) : null;
    const longPutStrike   = twoSd ? findClosest(spot - twoSd) : null;

    const shortCall = calls.find(o => o.strike === shortCallStrike);
    const shortPut  = puts.find(o => o.strike === shortPutStrike);
    const longCall  = longCallStrike ? calls.find(o => o.strike === longCallStrike) : null;
    const longPut   = longPutStrike  ? puts.find(o => o.strike === longPutStrike)   : null;

    const credit = ((shortCall?.mid ?? 0) + (shortPut?.mid ?? 0)
                  - (longCall?.mid  ?? 0) - (longPut?.mid  ?? 0));
    const width  = longCallStrike && shortCallStrike ? longCallStrike - shortCallStrike : null;
    const maxRisk = width ? width - credit : null;

    ironCondor = {
      shortCall: shortCallStrike, shortPut: shortPutStrike,
      longCall:  longCallStrike,  longPut:  longPutStrike,
      credit:    +credit.toFixed(2),
      maxRisk:   maxRisk != null ? +maxRisk.toFixed(2) : null,
      breakevenUp:   +(shortCallStrike + credit).toFixed(2),
      breakevenDown: +(shortPutStrike  - credit).toFixed(2),
    };
  }

  return { expiry, spot, straddle, ironCondor };
}

// ─── CLI display ───────────────────────────────────────────────────────────────

function printOptionsChain(data, expiry = null, maxStrikes = 10) {
  if (!data || !data.chain) { console.error('No data'); return; }

  const exp   = expiry ?? Object.keys(data.chain)[0];
  const entry = data.chain[exp];
  if (!entry) { console.error(`Expiry ${exp} not found`); return; }

  const { calls, puts, atmStrike, straddleCost, impliedMove } = entry;
  const spot = data.spotPrice;

  const f   = (n, d=2) => n != null ? Number(n).toFixed(d).padStart(7) : '     --';
  const fg  = (n, d=3) => n != null ? Number(n).toFixed(d).padStart(7) : '     --';
  const fiv = (n)      => n != null ? `${(n*100).toFixed(1)}%`.padStart(7) : '    --';
  const foi = (n)      => n != null ? n.toLocaleString().padStart(8) : '      --';

  console.log(`\n  ${data.ticker} — Spot: $${spot}  |  IV30: ${data.iv30?.toFixed(1) ?? '--'}%  |  Expiry: ${exp}`);
  console.log(`  ATM Strike: $${atmStrike}  |  Straddle: $${straddleCost}  |  Implied Move: ±${impliedMove != null ? (impliedMove*100).toFixed(1) : '--'}%\n`);

  const sep = '─'.repeat(118);
  console.log(`  ${sep}`);
  console.log(`  ${'CALLS'.padEnd(57)}│ Strike │${'PUTS'.padStart(57)}`);
  console.log(`  ${'Bid'.padStart(7)}${'Ask'.padStart(7)}${'IV%'.padStart(7)}${'Delta'.padStart(7)}${'Theta'.padStart(7)}${'Gamma'.padStart(7)}${'OI'.padStart(9)}  │        │  ${'OI'.padEnd(8)}${'Gamma'.padEnd(7)}${'Theta'.padEnd(7)}${'Delta'.padEnd(7)}${'IV%'.padEnd(7)}${'Ask'.padEnd(7)}${'Bid'.padEnd(7)}`);
  console.log(`  ${sep}`);

  // Merge strikes
  const strikeSet = [...new Set([...calls, ...puts].map(o => o.strike))].sort((a, b) => a - b);

  for (const strike of strikeSet) {
    const c = calls.find(o => o.strike === strike);
    const p = puts.find(o => o.strike === strike);
    const atm = strike === atmStrike ? '→' : ' ';
    const itmC = c?.itm ? '*' : ' ';
    const itmP = p?.itm ? '*' : ' ';

    const callSide = c
      ? `${f(c.bid)}${f(c.ask)}${fiv(c.iv)}${fg(c.delta)}${fg(c.theta)}${fg(c.gamma,4)}${foi(c.openInterest)}${itmC}`
      : ' '.repeat(57);
    const putSide = p
      ? `${itmP}${foi(p.openInterest)}${fg(p.gamma,4)}${fg(p.theta)}${fg(p.delta)}${fiv(p.iv)}${f(p.ask)}${f(p.bid)}`
      : ' '.repeat(57);

    console.log(`  ${callSide} │${atm}${String(strike).padStart(6)} │ ${putSide}`);
  }
  console.log(`  ${sep}\n`);
  console.log(`  * = In The Money`);
}

module.exports = { getOptionsChain, printOptionsChain, analyzeEarningsOptions, blackScholes };
