#!/usr/bin/env node
/**
 * TradingView CLI — fetch any market data from the command line
 *
 * Usage:
 *   node analyze.js quote     --symbol EURONEXT:CAC40
 *   node analyze.js ohlcv     --symbol AAPL --timeframe 1D --bars 50
 *   node analyze.js indicators --symbol AAPL --timeframe 1D --bars 200
 *   node analyze.js scan      --symbols "EURONEXT:CAC40,AAPL,BINANCE:BTCUSDT" --timeframes "1D,4h"
 *   node analyze.js search    --query CAC
 *   node analyze.js screen    --market america --preset oversold
 *   node analyze.js screen    --market america --rsi-min 30 --rsi-max 50 --cap-min 10
 *   node analyze.js screen    --market america --preset bullishBreakout
 *   node analyze.js chain     --symbol AAPL
 *   node analyze.js chain     --symbol AAPL --expiry 2026-05-16 --strikes 12
 *   node analyze.js calendar  --type earnings --from 2026-04-15 --to 2026-04-30
 */

'use strict';

const { TradingViewAnalyzer } = require('./market_analyzer');
const { TVScreener, screen, printScreen, printDetail } = require('./tv_screener');
const {
  getEconomicCalendar, getEarningsCalendar, getDividendCalendar,
  printEconomicCalendar, printEarningsCalendar, printDividendCalendar,
  dedupEarnings,
} = require('./tv_calendar');

// Lazy-load heavy modules
let _indicators = null, _optionsChain = null, _candidates = null;
function getIndicatorsMod () { return _indicators  || (_indicators  = require('./tv_indicators')); }
function getOptionsMod    () { return _optionsChain || (_optionsChain = require('./options_chain')); }
function getCandidatesMod () { return _candidates  || (_candidates  = require('./candidates')); }

// ─── Parse CLI arguments ──────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const command = args[0];

function flag (name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}
function flagBool (name) { return args.includes(`--${name}`); }

// ─── Formatters ───────────────────────────────────────────────────────────────

function pp (data) { console.log(JSON.stringify(data, null, 2)); }

function banner (text) {
  const line = '─'.repeat(text.length + 4);
  console.log(`\n┌${line}┐\n│  ${text}  │\n└${line}┘`);
}

function printQuote (q) {
  if (q.error) { console.error('Error:', q.error); return; }
  const sign = q.changePct >= 0 ? '+' : '';
  console.log(`
  Symbol : ${q.symbol}
  Price  : ${q.price}
  Open   : ${q.open}
  High   : ${q.high}
  Low    : ${q.low}
  Volume : ${q.volume ? Math.round(q.volume).toLocaleString('en-US') : 'N/A (index)'}
  Change : ${sign}${q.change?.toFixed(4)} (${sign}${q.changePct}%)
  Date   : ${q.date ?? q.isoTime?.slice(0,10) ?? 'N/A'}
`);
}

function fmt   (n) { return (n?.toFixed(2) ?? '--').padStart(10); }
function fmt2  (n) { return (n?.toFixed(2) ?? '--').padStart(7); }
function pct   (n) { return n != null ? `${(n*100).toFixed(1).padStart(6)}%` : '    --'; }
function oi    (n) { return (n?.toLocaleString() ?? '--').padStart(8); }

function printOHLCV (bars) {
  if (!Array.isArray(bars)) { pp(bars); return; }
  console.log('\n  Date         Open        High        Low         Close       Volume');
  console.log('  ' + '─'.repeat(72));
  for (const b of bars) {
    console.log(
      `  ${b.date}  ${fmt(b.open)}  ${fmt(b.high)}  ${fmt(b.low)}  ${fmt(b.close)}  ${(b.volume ?? 0).toLocaleString().padStart(12)}`
    );
  }
  console.log();
}

function printSearch (results) {
  if (!results.length) { console.log('  No results.'); return; }
  console.log('\n  Ticker                  Type       Exchange    Description');
  console.log('  ' + '─'.repeat(70));
  for (const r of results) {
    console.log(`  ${r.symbol.padEnd(24)}${(r.type ?? '').padEnd(11)}${(r.exchange ?? '').padEnd(12)}${r.description}`);
  }
  console.log();
}

function printScan (report) {
  for (const [sym, timeframes] of Object.entries(report)) {
    banner(sym);
    for (const [tf, data] of Object.entries(timeframes)) {
      console.log(`\n  Timeframe: ${tf}  |  Bias: ${data.bias?.toUpperCase()}`);
      printQuote(data.quote);
    }
  }
}

function printOptionsChainLocal (data) {
  // Fallback printer if options_chain.js not available
  if (data.error) { console.error('Error:', data.error); return; }
  console.log(`\n  Symbol: ${data.symbol}  |  Expiries: ${data.expiries?.length ?? 0}`);
  const expiries = Object.keys(data.chain ?? {}).slice(0, 5);
  for (const exp of expiries) {
    const entry = data.chain[exp];
    const calls = entry.calls ?? entry ?? [];
    const puts  = entry.puts  ?? [];
    const atmStrike = entry.atmStrike;
    const impliedMove = entry.impliedMove;
    console.log(`\n  Expiry: ${exp}${atmStrike ? `  |  ATM: $${atmStrike}` : ''}${impliedMove ? `  |  Implied Move: ±${(impliedMove*100).toFixed(1)}%` : ''}`);
    console.log('  ' + '─'.repeat(100));
    console.log('  Strike  │  CALL  Bid    Ask    Mid    IV%    Δ     OI     │  PUT   Bid    Ask    Mid    IV%    Δ     OI');
    console.log('  ' + '─'.repeat(100));

    const strikes = (calls.length ? calls : puts).slice(0, 16);
    for (const c of strikes) {
      const p = puts.find(x => x.strike === c.strike) ?? {};
      const atm = c.strike === atmStrike ? '→' : ' ';
      console.log(
        `  ${atm}${String(c.strike).padStart(6)}  │` +
        `  ${fmt2(c.bid)} ${fmt2(c.ask)} ${fmt2(c.mid ?? ((c.bid??0)+(c.ask??0))/2)} ${pct(c.iv)}  ${(c.delta??0).toFixed(2).padStart(5)} ${oi(c.openInterest)}  │` +
        `  ${fmt2(p.bid)} ${fmt2(p.ask)} ${fmt2(p.mid ?? ((p.bid??0)+(p.ask??0))/2)} ${pct(p.iv)}  ${(p.delta??0).toFixed(2).padStart(5)} ${oi(p.openInterest)}`
      );
    }
  }
  console.log();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function run () {
  if (!command || command === 'help') {
    console.log(`
TradingView Market Data Analyzer
─────────────────────────────────────────────────────────────────────────────

AGENT DE TRADING — MODULE 1
  candidates  --days-min 10 --days-max 25 --market america
              --days-min N    Earnings dans minimum N jours (défaut: 10)
              --days-max N    Earnings dans maximum N jours (défaut: 25)
              --min-cap  N    Capitalisation mini en Mds$ (défaut: 5)
              --output   console|json|file
              (Résultat mis en cache 12h dans ./cache/candidates_DATE.json)

COMMANDES DONNÉES DE MARCHÉ
  quote       --symbol <SYM>
  ohlcv       --symbol <SYM> [--timeframe TF] [--bars N]
  indicators  --symbol <SYM> [--timeframe TF] [--bars N]
              Calcule MM, RSI, MACD, Bollinger, ATR, VWAP, Stochastic...
  scan        --symbols "S1,S2,..." [--timeframes "TF1,TF2"]
  search      --query <texte> [--type stock|crypto|forex|index]

SCREENER
  screen      --market <marché> [options]
              --preset   oversold | overbought | bullishBreakout | goldenCross |
                         earningsPlay | strongMomentum | value | highVolatility
              --rsi-min / --rsi-max   Plage RSI
              --cap-min <milliards>   Cap boursière mini (ex: 5 pour 5B$)
              --vol-min <nombre>      Volume mini
              --sector <nom>          Secteur (Technology, Healthcare...)
              --pe-max <valeur>       P/E maximum
              --beta-max <valeur>     Beta maximum
              --limit <N>             Nombre de résultats (défaut: 30)

CHAÎNE D'OPTIONS
  chain       --symbol <SYM>
              --expiry <YYYY-MM-DD>   Expiry spécifique (optionnel)
              --strikes <N>           Nb strikes autour ATM (défaut: 10)
              --earnings              Analyse earnings play (straddle, iron condor)

CALENDRIERS
  calendar    --type eco|earnings|dividends|all
              --from <YYYY-MM-DD> --to <YYYY-MM-DD>
              --days <N>
              --importance 1|2|3 (eco seulement)
              --countries "US,EU,FR,DE,GB,JP"

MARCHÉS DISPONIBLES
  america (us) | france | europe | germany | uk | canada | australia
  india | japan | brazil | crypto | forex | futures

TIMEFRAMES
  1m 5m 15m 30m 1h 4h 1D 1W 1M

EXEMPLES
  node analyze.js quote      --symbol EURONEXT:CAC40
  node analyze.js ohlcv      --symbol AAPL --timeframe 4h --bars 100
  node analyze.js indicators --symbol AAPL --timeframe 1D --bars 200
  node analyze.js chain      --symbol AAPL --expiry 2026-05-16 --strikes 12
  node analyze.js chain      --symbol AAPL --earnings
  node analyze.js screen     --market america --preset oversold --limit 20
  node analyze.js screen     --market america --rsi-min 40 --rsi-max 60 --cap-min 10
  node analyze.js screen     --market france  --preset bullishBreakout
  node analyze.js screen     --market america --sector Technology --pe-max 25
  node analyze.js calendar   --type earnings --from 2026-04-20 --to 2026-05-05
`);
    return;
  }

  // ── MODULE 1 : Candidates ───────────────────────────────────────────────────
  if (command === 'candidates') {
    const daysMin = parseInt(flag('days-min', '10'), 10);
    const daysMax = parseInt(flag('days-max', '25'), 10);
    const market  = flag('market',  'america');
    const minCapB = parseFloat(flag('min-cap', '5'));
    const output  = flag('output',  'console');
    const { runCandidates } = getCandidatesMod();
    await runCandidates({ daysMin, daysMax, market, minCapB, output });
    return;
  }

  // ── Calendar ────────────────────────────────────────────────────────────────
  if (command === 'calendar') {
    const type       = flag('type', 'eco');
    const days       = parseInt(flag('days', '7'), 10);
    const importance = parseInt(flag('importance', '2'), 10);
    const countries  = (flag('countries', 'US,EU,GB,JP,FR,DE,CN') ?? '').split(',');
    const markets    = (flag('markets', '') ?? '').split(',').filter(Boolean);
    const capMin     = parseFloat(flag('cap-min', '0'));
    const noOtc      = flagBool('no-otc');
    const dedup      = flagBool('dedup') || noOtc;
    const limit      = parseInt(flag('limit', capMin > 0 || dedup ? '500' : '100'), 10);
    const fromFlag   = flag('from', null);
    const toFlag     = flag('to', null);
    const from = fromFlag ? new Date(fromFlag) : new Date();
    const to   = toFlag   ? new Date(toFlag)   : (() => { const d = new Date(); d.setDate(d.getDate() + days); return d; })();

    if (type === 'eco' || type === 'economic' || type === 'macro') {
      banner(`Calendrier Économique`);
      printEconomicCalendar(await getEconomicCalendar({ from, to, countries, importance }));
    } else if (type === 'earnings') {
      banner(`Calendrier Earnings`);
      let earns = await getEarningsCalendar({ from, to, markets, limit, capMin });
      if (dedup) earns = dedupEarnings(earns, { noOtc });
      printEarningsCalendar(earns);
    } else if (type === 'dividends' || type === 'div') {
      banner(`Calendrier Dividendes`);
      printDividendCalendar(await getDividendCalendar({ from, to, markets, limit }));
    } else if (type === 'all') {
      banner(`Tous les calendriers`);
      const [eco, earn, div] = await Promise.all([
        getEconomicCalendar({ from, to, countries, importance }),
        getEarningsCalendar({ from, to, markets, limit, capMin }),
        getDividendCalendar({ from, to, markets, limit }),
      ]);
      printEconomicCalendar(eco);
      printEarningsCalendar(earn);
      printDividendCalendar(div);
    }
    return;
  }

  // ── Screener ────────────────────────────────────────────────────────────────
  if (command === 'screen') {
    const market  = flag('market', 'america');
    const limitN  = parseInt(flag('limit', '30'), 10);
    const preset  = flag('preset', null);
    const rsiMin  = parseFloat(flag('rsi-min', '0'));
    const rsiMax  = parseFloat(flag('rsi-max', '100'));
    const capMin  = parseFloat(flag('cap-min', '0'));
    const volMin  = parseFloat(flag('vol-min', '0'));
    const sector  = flag('sector', null);
    const peMax   = parseFloat(flag('pe-max', '0'));
    const betaMax = parseFloat(flag('beta-max', '0'));

    banner(`Screener: ${market.toUpperCase()}${preset ? ' — ' + preset : ''}`);

    let results;
    const presetMap = {
      'oversold':        () => TVScreener.oversold(market, rsiMax || 35, limitN),
      'overbought':      () => TVScreener.overbought(market, rsiMin || 70, limitN),
      'bullishBreakout': () => TVScreener.bullishBreakout(market, limitN),
      'goldenCross':     () => TVScreener.goldenCross(market, limitN),
      'earningsPlay':    () => TVScreener.earningsPlay(market, 20, limitN),
      'strongMomentum':  () => TVScreener.strongMomentum(market, limitN),
      'value':           () => TVScreener.value(market, limitN),
      'highVolatility':  () => TVScreener.highVolatility(market, limitN),
    };

    if (preset && presetMap[preset]) {
      results = await presetMap[preset]();
    } else {
      const s = new TVScreener(market).limit(limitN)
        .select('close', 'change', 'volume', 'avgVolume10', 'rsi', 'ema20', 'ema50', 'ema200',
                'atr', 'adx', 'bbWidth', 'beta', 'pe', 'marketCap', 'sector', 'description')
        .sortBy('marketCap', 'desc');

      if (rsiMin > 0 && rsiMax < 100) s.filter('rsi', 'between', rsiMin, rsiMax);
      else if (rsiMin > 0)            s.filter('rsi', '>', rsiMin);
      else if (rsiMax < 100)          s.filter('rsi', '<', rsiMax);
      if (capMin  > 0)   s.filter('marketCap', '>', capMin * 1e9);
      if (volMin  > 0)   s.filter('volume', '>', volMin);
      if (peMax   > 0)   s.filter('pe', '<', peMax);
      if (betaMax > 0)   s.filter('beta', '<', betaMax);
      if (sector)        s.filter('sector', 'match', sector);

      results = await s.run();
    }
    printScreen(results, `${market.toUpperCase()} — ${results.length} résultats`);
    return;
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  if (command === 'search') {
    const query = flag('query', '');
    const type  = flag('type', '');
    const limit = parseInt(flag('limit', '15'), 10);
    banner(`Search: "${query}"`);
    const analyzer = new TradingViewAnalyzer();
    printSearch(await analyzer.search(query, type, limit));
    return;
  }

  // ── Options chain ───────────────────────────────────────────────────────────
  if (command === 'chain' || command === 'options') {
    const symbol  = flag('symbol', 'AAPL');
    const expiry  = flag('expiry', null);
    const strikes = parseInt(flag('strikes', '10'), 10);
    const earnings = flagBool('earnings');
    banner(`Options Chain: ${symbol}`);

    try {
      const { getOptionsChain, printOptionsChain, analyzeEarningsOptions } = getOptionsMod();
      const data = await getOptionsChain(symbol, { expiry, strikes });
      printOptionsChain(data, expiry, strikes);
      if (earnings && expiry) {
        console.log('\n  ── Earnings Play Analysis ──');
        pp(analyzeEarningsOptions(data, expiry));
      }
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        // Fallback to basic Yahoo chain via analyzer
        const analyzer = new TradingViewAnalyzer();
        printOptionsChainLocal(await analyzer.getOptionsChain(symbol));
      } else throw e;
    }
    return;
  }

  // ── OHLCV + Indicators ──────────────────────────────────────────────────────
  if (command === 'indicators') {
    const symbol    = flag('symbol', 'AAPL');
    const timeframe = flag('timeframe', '1D');
    const bars      = parseInt(flag('bars', '200'), 10);
    banner(`Indicators: ${symbol} ${timeframe}`);

    const analyzer = new TradingViewAnalyzer();
    await analyzer.connect();
    try {
      const rawBars = await analyzer.getOHLCV(symbol, timeframe, bars);
      const { addIndicators, printIndicators } = getIndicatorsMod();
      const enriched = addIndicators(rawBars);
      printIndicators(enriched);
    } finally { analyzer.disconnect(); }
    return;
  }

  // ── Quote / OHLCV / Scan ────────────────────────────────────────────────────
  if (command === 'quote' || command === 'ohlcv' || command === 'scan') {
    const analyzer = new TradingViewAnalyzer();
    await analyzer.connect();
    try {
      if (command === 'quote') {
        banner(`Quote: ${flag('symbol', 'AAPL')}`);
        printQuote(await analyzer.getQuote(flag('symbol', 'AAPL')));

      } else if (command === 'ohlcv') {
        const symbol    = flag('symbol', 'AAPL');
        const timeframe = flag('timeframe', '1D');
        const bars      = parseInt(flag('bars', '50'), 10);
        banner(`OHLCV: ${symbol} ${timeframe}`);
        printOHLCV(await analyzer.getOHLCV(symbol, timeframe, bars));

      } else if (command === 'scan') {
        const rawSymbols    = flag('symbols', 'AAPL');
        const rawTimeframes = flag('timeframes', '1D');
        const symbols       = rawSymbols.split(',').map(s => s.trim());
        const timeframes    = rawTimeframes.split(',').map(s => s.trim());
        banner(`Scan: ${symbols.join(', ')}`);
        printScan(await analyzer.scan(symbols, timeframes));
      }
    } finally { analyzer.disconnect(); }
    return;
  }

  // ── CDP commands (TradingView Desktop requis) ──────────────────────────────
  if (command === 'levels') {
    const analyzer = new TradingViewAnalyzer({ port: parseInt(flag('port', '9222'), 10) });
    try {
      await analyzer.connect();
      await analyzer.connectDesktop();
      banner(`Key Levels: ${flag('symbol', 'AAPL')}`);
      pp(await analyzer.getKeyLevels(flag('symbol', 'AAPL'), flag('timeframe', '1D')));
    } catch (e) {
      console.error(`\n  Cannot connect to TradingView Desktop: ${e.message}`);
    } finally { analyzer.disconnect(); }
    return;
  }

  console.error(`\n  Commande inconnue: "${command}"  → node analyze.js help`);
  process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
