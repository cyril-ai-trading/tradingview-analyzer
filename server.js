/**
 * TradingView Analyzer — Interface Web Locale
 * Lance un serveur sur http://localhost:3000
 * node server.js
 */
'use strict';

const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const { TradingViewAnalyzer }                    = require('./market_analyzer');
const { TVScreener }                             = require('./tv_screener');
const { getEconomicCalendar, getEarningsCalendar, getDividendCalendar } = require('./tv_calendar');
const { TVFeed }                                 = require('./tv_feed');

const PORT = 3000;

// ─── Router ───────────────────────────────────────────────────────────────────

async function handleAPI(req, res, url) {
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // ── Quote ──────────────────────────────────────────────────────────────
    if (p === '/api/quote') {
      const feed = new TVFeed(); await feed.connect();
      try   { res.end(JSON.stringify(await feed.getQuote(q.symbol))); }
      finally { feed.disconnect(); }

    // ── OHLCV ──────────────────────────────────────────────────────────────
    } else if (p === '/api/ohlcv') {
      const feed = new TVFeed(); await feed.connect();
      try   { res.end(JSON.stringify(await feed.getOHLCV(q.symbol, q.timeframe || 'D', parseInt(q.bars||'100')))); }
      finally { feed.disconnect(); }

    // ── Scan ───────────────────────────────────────────────────────────────
    } else if (p === '/api/scan') {
      const symbols    = (q.symbols || 'AAPL').split(',').map(s => s.trim());
      const timeframes = (q.timeframes || '1D').split(',').map(s => s.trim());
      const analyzer   = new TradingViewAnalyzer();
      await analyzer.connect();
      try   { res.end(JSON.stringify(await analyzer.scan(symbols, timeframes))); }
      finally { analyzer.disconnect(); }

    // ── Search ─────────────────────────────────────────────────────────────
    } else if (p === '/api/search') {
      const analyzer = new TradingViewAnalyzer();
      res.end(JSON.stringify(await analyzer.search(q.query||'', q.type||'', parseInt(q.limit||'20'))));

    // ── Screener ───────────────────────────────────────────────────────────
    } else if (p === '/api/screen') {
      const s = new TVScreener(q.market || 'america')
        .limit(parseInt(q.limit || '50'))
        .select('close','change','volume','RSI','EMA20','EMA50','market_cap_basic','sector','description')
        .sortBy('market_cap_basic', 'desc');

      if (q.rsiMin) s.filter('rsi', '>', parseFloat(q.rsiMin));
      if (q.rsiMax) s.filter('rsi', '<', parseFloat(q.rsiMax));
      if (q.capMin) s.filter('marketCap', '>', parseFloat(q.capMin) * 1e9);
      if (q.volMin) s.filter('volume', '>', parseFloat(q.volMin));
      if (q.sector) s.filter('sector', 'match', q.sector);
      if (q.rsiMin && q.rsiMax) {
        // reset and use between
        s._filters = s._filters.filter(f => f.left !== 'RSI');
        s.filter('rsi', 'between', parseFloat(q.rsiMin), parseFloat(q.rsiMax));
      }
      res.end(JSON.stringify(await s.run()));

    // ── Calendrier économique ──────────────────────────────────────────────
    } else if (p === '/api/calendar/eco') {
      const from       = q.from ? new Date(q.from) : new Date();
      const to         = q.to   ? new Date(q.to)   : (() => { const d=new Date(); d.setDate(d.getDate()+7); return d; })();
      const countries  = (q.countries || 'US,EU,GB,JP,FR,DE,CN').split(',');
      const importance = parseInt(q.importance || '2');
      res.end(JSON.stringify(await getEconomicCalendar({ from, to, countries, importance })));

    // ── Calendrier earnings ────────────────────────────────────────────────
    } else if (p === '/api/calendar/earnings') {
      const from    = q.from ? new Date(q.from) : new Date();
      const to      = q.to   ? new Date(q.to)   : (() => { const d=new Date(); d.setDate(d.getDate()+7); return d; })();
      const markets = q.markets ? q.markets.split(',') : [];
      res.end(JSON.stringify(await getEarningsCalendar({ from, to, markets, limit: parseInt(q.limit||'100') })));

    // ── Calendrier dividendes ──────────────────────────────────────────────
    } else if (p === '/api/calendar/dividends') {
      const from    = q.from ? new Date(q.from) : new Date();
      const to      = q.to   ? new Date(q.to)   : (() => { const d=new Date(); d.setDate(d.getDate()+30); return d; })();
      const markets = q.markets ? q.markets.split(',') : [];
      res.end(JSON.stringify(await getDividendCalendar({ from, to, markets, limit: parseInt(q.limit||'100') })));

    } else {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch(e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    return handleAPI(req, res, url);
  }

  // Serve the HTML UI
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`\n  ✅ Interface ouverte sur → http://localhost:${PORT}\n`);
  // Auto-open browser on Windows
  try { require('child_process').exec(`start http://localhost:${PORT}`); } catch(_) {}
});

// ─── HTML Interface ───────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TradingView Analyzer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0d1117; color: #e6edf3; min-height: 100vh; }

  /* Layout */
  .app { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
  .sidebar { background: #161b22; border-right: 1px solid #30363d; padding: 20px 0; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .main { padding: 24px; overflow-x: hidden; }

  /* Sidebar */
  .logo { padding: 0 20px 20px; border-bottom: 1px solid #30363d; margin-bottom: 16px; }
  .logo h1 { font-size: 16px; font-weight: 700; color: #58a6ff; }
  .logo p  { font-size: 11px; color: #8b949e; margin-top: 4px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 20px;
              cursor: pointer; color: #8b949e; font-size: 14px; border-left: 3px solid transparent;
              transition: all .15s; }
  .nav-item:hover { background: #1f2937; color: #e6edf3; }
  .nav-item.active { background: #1f2937; color: #58a6ff; border-left-color: #58a6ff; }
  .nav-icon { font-size: 18px; width: 22px; text-align: center; }
  .nav-group { padding: 12px 20px 4px; font-size: 11px; color: #6e7681; text-transform: uppercase; letter-spacing: .8px; }

  /* Cards */
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  .card-title { font-size: 16px; font-weight: 600; color: #e6edf3; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

  /* Forms */
  .form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 12px; color: #8b949e; font-weight: 500; }
  input, select { background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 6px;
                  padding: 8px 12px; font-size: 14px; outline: none; min-width: 140px; }
  input:focus, select:focus { border-color: #58a6ff; }
  input[type="date"] { min-width: 150px; color-scheme: dark; }

  button { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 8px 18px;
           font-size: 14px; cursor: pointer; font-weight: 600; transition: background .15s; white-space: nowrap; }
  button:hover { background: #2ea043; }
  button:disabled { background: #21262d; color: #6e7681; cursor: not-allowed; }
  .btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  .btn-secondary:hover { background: #30363d; }

  /* Tables */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #0d1117; color: #8b949e; font-weight: 600; padding: 10px 12px;
       text-align: left; border-bottom: 1px solid #30363d; white-space: nowrap; }
  td { padding: 9px 12px; border-bottom: 1px solid #21262d; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1f2937; }
  .up   { color: #3fb950; font-weight: 600; }
  .down { color: #f85149; font-weight: 600; }
  .neutral { color: #d29922; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
  .badge-bull { background: #1a3a1a; color: #3fb950; }
  .badge-bear { background: #3a1a1a; color: #f85149; }
  .badge-neu  { background: #2a2a1a; color: #d29922; }
  .badge-high { background: #3a1a1a; color: #f85149; }
  .badge-med  { background: #2a2210; color: #e3b341; }
  .badge-low  { background: #161b22; color: #8b949e; }

  /* Quote card */
  .quote-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .quote-item { background: #0d1117; border-radius: 8px; padding: 14px; }
  .quote-label { font-size: 11px; color: #6e7681; margin-bottom: 4px; text-transform: uppercase; }
  .quote-value { font-size: 22px; font-weight: 700; }
  .quote-sub   { font-size: 12px; color: #8b949e; margin-top: 4px; }

  /* Charts (mini sparkline) */
  canvas { display: block; }

  /* Loading */
  .loading { display: flex; align-items: center; gap: 10px; color: #8b949e; padding: 20px 0; }
  .spinner { width: 18px; height: 18px; border: 2px solid #30363d; border-top-color: #58a6ff;
             border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Status bar */
  #status { position: fixed; bottom: 16px; right: 16px; background: #161b22; border: 1px solid #30363d;
            border-radius: 8px; padding: 10px 16px; font-size: 13px; color: #8b949e;
            display: none; max-width: 360px; z-index: 999; }
  #status.show { display: block; }
  #status.error { border-color: #f85149; color: #f85149; }
  #status.ok    { border-color: #3fb950; color: #3fb950; }

  /* Pages */
  .page { display: none; }
  .page.active { display: block; }

  /* Section tabs */
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
  .tab { padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
         color: #8b949e; transition: all .15s; border: 1px solid transparent; }
  .tab.active { background: #1f2937; color: #58a6ff; border-color: #30363d; }
  .tab:hover:not(.active) { color: #e6edf3; }

  .empty { text-align: center; color: #6e7681; padding: 40px; font-size: 14px; }
  .count { font-size: 12px; color: #6e7681; font-weight: 400; margin-left: 8px; }
</style>
</head>
<body>
<div class="app">

<!-- Sidebar -->
<aside class="sidebar">
  <div class="logo">
    <h1>📈 TV Analyzer</h1>
    <p>TradingView Market Data</p>
  </div>
  <div class="nav-group">Marché</div>
  <div class="nav-item active" onclick="showPage('quote')">
    <span class="nav-icon">💲</span> Quote Live
  </div>
  <div class="nav-item" onclick="showPage('scan')">
    <span class="nav-icon">🔍</span> Multi-Scan
  </div>
  <div class="nav-item" onclick="showPage('ohlcv')">
    <span class="nav-icon">🕯️</span> Bougies OHLCV
  </div>
  <div class="nav-item" onclick="showPage('search')">
    <span class="nav-icon">🔎</span> Recherche
  </div>

  <div class="nav-group">Analyse</div>
  <div class="nav-item" onclick="showPage('screen')">
    <span class="nav-icon">⚡</span> Screener
  </div>

  <div class="nav-group">Calendriers</div>
  <div class="nav-item" onclick="showPage('cal-eco')">
    <span class="nav-icon">🌍</span> Économique
  </div>
  <div class="nav-item" onclick="showPage('cal-earn')">
    <span class="nav-icon">📊</span> Earnings
  </div>
  <div class="nav-item" onclick="showPage('cal-div')">
    <span class="nav-icon">💰</span> Dividendes
  </div>
</aside>

<!-- Main -->
<main class="main">

  <!-- ── QUOTE ── -->
  <div id="page-quote" class="page active">
    <div class="card">
      <div class="card-title">💲 Quote Live</div>
      <div class="form-row">
        <div class="form-group">
          <label>Symbole</label>
          <input id="q-sym" value="TVC:CAC40" placeholder="TVC:CAC40, AAPL, BINANCE:BTCUSDT" style="min-width:260px">
        </div>
        <button onclick="loadQuote()">Obtenir</button>
      </div>
      <div id="quote-result"></div>
    </div>
  </div>

  <!-- ── SCAN ── -->
  <div id="page-scan" class="page">
    <div class="card">
      <div class="card-title">🔍 Multi-Scan</div>
      <div class="form-row">
        <div class="form-group">
          <label>Symboles (séparés par virgule)</label>
          <input id="sc-syms" value="TVC:CAC40,NASDAQ:AAPL,BINANCE:BTCUSDT" style="min-width:400px">
        </div>
        <div class="form-group">
          <label>Timeframes</label>
          <input id="sc-tfs" value="1D" placeholder="1D,4h,1W" style="min-width:140px">
        </div>
        <button onclick="loadScan()">Scanner</button>
      </div>
      <div id="scan-result"></div>
    </div>
  </div>

  <!-- ── OHLCV ── -->
  <div id="page-ohlcv" class="page">
    <div class="card">
      <div class="card-title">🕯️ Bougies OHLCV</div>
      <div class="form-row">
        <div class="form-group">
          <label>Symbole</label>
          <input id="oh-sym" value="NASDAQ:AAPL">
        </div>
        <div class="form-group">
          <label>Timeframe</label>
          <select id="oh-tf">
            <option value="D">Journalier</option>
            <option value="W">Hebdomadaire</option>
            <option value="M">Mensuel</option>
            <option value="240">4 Heures</option>
            <option value="60">1 Heure</option>
            <option value="15">15 Min</option>
            <option value="5">5 Min</option>
          </select>
        </div>
        <div class="form-group">
          <label>Nombre de bougies</label>
          <input id="oh-bars" type="number" value="50" style="min-width:80px">
        </div>
        <button onclick="loadOHLCV()">Charger</button>
      </div>
      <div id="ohlcv-result"></div>
    </div>
  </div>

  <!-- ── SEARCH ── -->
  <div id="page-search" class="page">
    <div class="card">
      <div class="card-title">🔎 Recherche de Symbole</div>
      <div class="form-row">
        <div class="form-group">
          <label>Recherche</label>
          <input id="sr-q" placeholder="Apple, CAC, Bitcoin..." style="min-width:240px"
                 onkeydown="if(event.key==='Enter') loadSearch()">
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="sr-type">
            <option value="">Tous</option>
            <option value="stock">Actions</option>
            <option value="index">Indices</option>
            <option value="crypto">Crypto</option>
            <option value="forex">Forex</option>
            <option value="futures">Futures</option>
          </select>
        </div>
        <button onclick="loadSearch()">Rechercher</button>
      </div>
      <div id="search-result"></div>
    </div>
  </div>

  <!-- ── SCREENER ── -->
  <div id="page-screen" class="page">
    <div class="card">
      <div class="card-title">⚡ Screener</div>
      <div class="form-row">
        <div class="form-group">
          <label>Marché</label>
          <select id="sc2-market">
            <option value="america">🇺🇸 US</option>
            <option value="france">🇫🇷 France</option>
            <option value="europe">🇪🇺 Europe</option>
            <option value="germany">🇩🇪 Allemagne</option>
            <option value="uk">🇬🇧 UK</option>
            <option value="crypto">₿ Crypto</option>
            <option value="forex">💱 Forex</option>
            <option value="canada">🇨🇦 Canada</option>
            <option value="india">🇮🇳 Inde</option>
            <option value="japan">🇯🇵 Japon</option>
          </select>
        </div>
        <div class="form-group">
          <label>RSI Min</label>
          <input id="sc2-rmin" type="number" placeholder="ex: 30" style="min-width:90px">
        </div>
        <div class="form-group">
          <label>RSI Max</label>
          <input id="sc2-rmax" type="number" placeholder="ex: 70" style="min-width:90px">
        </div>
        <div class="form-group">
          <label>Cap. Min (Mrd $)</label>
          <input id="sc2-cap" type="number" placeholder="ex: 1" style="min-width:110px">
        </div>
        <div class="form-group">
          <label>Secteur</label>
          <input id="sc2-sec" placeholder="Technology" style="min-width:140px">
        </div>
        <div class="form-group">
          <label>Résultats</label>
          <input id="sc2-lim" type="number" value="30" style="min-width:80px">
        </div>
        <button onclick="loadScreen()">Filtrer</button>
      </div>
      <div id="screen-result"></div>
    </div>
  </div>

  <!-- ── CAL ECO ── -->
  <div id="page-cal-eco" class="page">
    <div class="card">
      <div class="card-title">🌍 Calendrier Économique</div>
      <div class="form-row">
        <div class="form-group">
          <label>Du</label>
          <input type="date" id="ce-from">
        </div>
        <div class="form-group">
          <label>Au</label>
          <input type="date" id="ce-to">
        </div>
        <div class="form-group">
          <label>Importance min</label>
          <select id="ce-imp">
            <option value="1">🟡 Toutes</option>
            <option value="2" selected>🟠 Medium+</option>
            <option value="3">🔴 Haute seulement</option>
          </select>
        </div>
        <div class="form-group">
          <label>Pays</label>
          <input id="ce-ctry" value="US,EU,GB,JP,FR,DE,CN" style="min-width:220px">
        </div>
        <button onclick="loadCalEco()">Charger</button>
      </div>
      <div id="cal-eco-result"></div>
    </div>
  </div>

  <!-- ── CAL EARNINGS ── -->
  <div id="page-cal-earn" class="page">
    <div class="card">
      <div class="card-title">📊 Calendrier Earnings</div>
      <div class="form-row">
        <div class="form-group">
          <label>Du</label>
          <input type="date" id="earn-from">
        </div>
        <div class="form-group">
          <label>Au</label>
          <input type="date" id="earn-to">
        </div>
        <div class="form-group">
          <label>Marché</label>
          <select id="earn-mkt">
            <option value="">🌍 Mondial</option>
            <option value="america">🇺🇸 US</option>
            <option value="france">🇫🇷 France</option>
            <option value="europe">🇪🇺 Europe</option>
            <option value="uk">🇬🇧 UK</option>
          </select>
        </div>
        <div class="form-group">
          <label>Max résultats</label>
          <input id="earn-lim" type="number" value="100" style="min-width:90px">
        </div>
        <button onclick="loadCalEarn()">Charger</button>
      </div>
      <div id="cal-earn-result"></div>
    </div>
  </div>

  <!-- ── CAL DIV ── -->
  <div id="page-cal-div" class="page">
    <div class="card">
      <div class="card-title">💰 Calendrier Dividendes</div>
      <div class="form-row">
        <div class="form-group">
          <label>Du</label>
          <input type="date" id="div-from">
        </div>
        <div class="form-group">
          <label>Au</label>
          <input type="date" id="div-to">
        </div>
        <div class="form-group">
          <label>Marché</label>
          <select id="div-mkt">
            <option value="">🌍 Mondial</option>
            <option value="america">🇺🇸 US</option>
            <option value="france">🇫🇷 France</option>
            <option value="europe">🇪🇺 Europe</option>
          </select>
        </div>
        <div class="form-group">
          <label>Max résultats</label>
          <input id="div-lim" type="number" value="100" style="min-width:90px">
        </div>
        <button onclick="loadCalDiv()">Charger</button>
      </div>
      <div id="cal-div-result"></div>
    </div>
  </div>

</main>
</div>

<div id="status"></div>

<script>
// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(offset=0) {
  const d = new Date(); d.setDate(d.getDate()+offset);
  return d.toISOString().split('T')[0];
}

// Set default dates
document.getElementById('ce-from').value   = todayStr();
document.getElementById('ce-to').value     = todayStr(7);
document.getElementById('earn-from').value = todayStr();
document.getElementById('earn-to').value   = todayStr(14);
document.getElementById('div-from').value  = todayStr();
document.getElementById('div-to').value    = todayStr(30);

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  event.currentTarget.classList.add('active');
}

function status(msg, type='') {
  const el = document.getElementById('status');
  el.textContent = msg; el.className = 'show ' + type;
  setTimeout(() => el.className = '', 3000);
}

function loading(id) {
  document.getElementById(id).innerHTML =
    '<div class="loading"><div class="spinner"></div> Chargement...</div>';
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function fmt(n, dec=2) {
  if (n == null) return '--';
  return Number(n).toLocaleString('fr-FR', {minimumFractionDigits:dec, maximumFractionDigits:dec});
}
function fmtBig(n) {
  if (n == null) return '--';
  if (n >= 1e12) return (n/1e12).toFixed(1)+'T';
  if (n >= 1e9)  return (n/1e9).toFixed(1)+'Md';
  if (n >= 1e6)  return (n/1e6).toFixed(1)+'M';
  return n;
}
function chgClass(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
function biasClass(b) { return b==='bullish'?'badge badge-bull':b==='bearish'?'badge badge-bear':'badge badge-neu'; }
function impClass(i)  { return i===3?'badge badge-high':i===2?'badge badge-med':'badge badge-low'; }
function impLabel(i)  { return i===3?'🔴 Haute':i===2?'🟠 Moyenne':'🟡 Basse'; }

// ── QUOTE ────────────────────────────────────────────────────────────────────

async function loadQuote() {
  const sym = document.getElementById('q-sym').value.trim();
  if (!sym) return;
  loading('quote-result');
  try {
    const q = await api('/api/quote?symbol='+encodeURIComponent(sym));
    if (q.error) throw new Error(q.error);
    const chg = q.change ?? (q.price - q.prevClose);
    const pct  = q.changePct ?? (chg/q.prevClose*100);
    document.getElementById('quote-result').innerHTML = \`
      <div class="quote-grid">
        <div class="quote-item">
          <div class="quote-label">Prix</div>
          <div class="quote-value">\${fmt(q.price)}</div>
          <div class="quote-sub \${chgClass(chg)}">\${chg>=0?'+':''}\${fmt(chg)} (\${fmt(pct)}%)</div>
        </div>
        <div class="quote-item">
          <div class="quote-label">Ouverture</div>
          <div class="quote-value">\${fmt(q.open)}</div>
        </div>
        <div class="quote-item">
          <div class="quote-label">Haut</div>
          <div class="quote-value" style="color:#3fb950">\${fmt(q.high)}</div>
        </div>
        <div class="quote-item">
          <div class="quote-label">Bas</div>
          <div class="quote-value" style="color:#f85149">\${fmt(q.low)}</div>
        </div>
        <div class="quote-item">
          <div class="quote-label">Volume</div>
          <div class="quote-value" style="font-size:18px">\${fmtBig(q.volume)}</div>
        </div>
        <div class="quote-item">
          <div class="quote-label">Date</div>
          <div class="quote-value" style="font-size:16px">\${q.date ?? q.isoTime?.slice(0,10)}</div>
        </div>
      </div>\`;
    status('Quote chargée', 'ok');
  } catch(e) { document.getElementById('quote-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── OHLCV ────────────────────────────────────────────────────────────────────

async function loadOHLCV() {
  const sym  = document.getElementById('oh-sym').value.trim();
  const tf   = document.getElementById('oh-tf').value;
  const bars = document.getElementById('oh-bars').value;
  loading('ohlcv-result');
  try {
    const data = await api(\`/api/ohlcv?symbol=\${encodeURIComponent(sym)}&timeframe=\${tf}&bars=\${bars}\`);
    if (!Array.isArray(data)) throw new Error(data.error || 'Erreur');
    const rows = data.slice(-50).reverse().map(b => \`
      <tr>
        <td>\${b.date}</td>
        <td>\${fmt(b.open)}</td>
        <td style="color:#3fb950">\${fmt(b.high)}</td>
        <td style="color:#f85149">\${fmt(b.low)}</td>
        <td style="font-weight:600">\${fmt(b.close)}</td>
        <td style="color:#8b949e">\${fmtBig(b.volume)}</td>
        <td class="\${b.close>=b.open?'up':'down'}">\${b.close>=b.open?'▲':'▼'} \${fmt(Math.abs((b.close-b.open)/b.open*100))}%</td>
      </tr>\`).join('');
    document.getElementById('ohlcv-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th><th>Var.</th></tr>
        \${rows}
      </table></div>\`;
    status(\`\${data.length} bougies chargées\`, 'ok');
  } catch(e) { document.getElementById('ohlcv-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── SCAN ─────────────────────────────────────────────────────────────────────

async function loadScan() {
  const syms = document.getElementById('sc-syms').value.trim();
  const tfs  = document.getElementById('sc-tfs').value.trim();
  loading('scan-result');
  try {
    const data = await api(\`/api/scan?symbols=\${encodeURIComponent(syms)}&timeframes=\${encodeURIComponent(tfs)}\`);
    let html = '';
    for (const [sym, tframes] of Object.entries(data)) {
      for (const [tf, d] of Object.entries(tframes)) {
        const q = d.quote;
        html += \`<tr>
          <td style="font-weight:600;color:#58a6ff">\${sym}</td>
          <td>\${tf}</td>
          <td>\${fmt(q.price)}</td>
          <td class="\${chgClass(q.change)}">\${q.change>=0?'+':''}\${fmt(q.changePct)}%</td>
          <td>\${fmtBig(q.volume)}</td>
          <td><span class="\${biasClass(d.bias)}">\${d.bias?.toUpperCase()}</span></td>
        </tr>\`;
      }
    }
    document.getElementById('scan-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Symbole</th><th>TF</th><th>Prix</th><th>Chg%</th><th>Volume</th><th>Biais</th></tr>
        \${html}
      </table></div>\`;
    status('Scan terminé', 'ok');
  } catch(e) { document.getElementById('scan-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── SEARCH ───────────────────────────────────────────────────────────────────

async function loadSearch() {
  const q    = document.getElementById('sr-q').value.trim();
  const type = document.getElementById('sr-type').value;
  if (!q) return;
  loading('search-result');
  try {
    const data = await api(\`/api/search?query=\${encodeURIComponent(q)}&type=\${type}&limit=20\`);
    const rows = data.map(r => \`<tr>
      <td style="color:#58a6ff;font-weight:600">\${r.symbol}</td>
      <td>\${r.description}</td>
      <td>\${r.exchange}</td>
      <td><span class="badge badge-neu">\${r.type}</span></td>
      <td>\${r.currency??'--'}</td>
    </tr>\`).join('');
    document.getElementById('search-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Symbole</th><th>Nom</th><th>Bourse</th><th>Type</th><th>Devise</th></tr>
        \${rows}
      </table></div>\`;
  } catch(e) { document.getElementById('search-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; }
}

// ── SCREENER ─────────────────────────────────────────────────────────────────

async function loadScreen() {
  const mkt  = document.getElementById('sc2-market').value;
  const rmin = document.getElementById('sc2-rmin').value;
  const rmax = document.getElementById('sc2-rmax').value;
  const cap  = document.getElementById('sc2-cap').value;
  const sec  = document.getElementById('sc2-sec').value;
  const lim  = document.getElementById('sc2-lim').value;
  loading('screen-result');
  const params = new URLSearchParams({ market:mkt, limit:lim });
  if (rmin) params.set('rsiMin', rmin);
  if (rmax) params.set('rsiMax', rmax);
  if (cap)  params.set('capMin', cap);
  if (sec)  params.set('sector', sec);
  try {
    const data = await api('/api/screen?'+params);
    const rows = data.map(r => \`<tr>
      <td style="color:#58a6ff;font-weight:600">\${r._symbol}</td>
      <td>\${r.description??r.name??'--'}</td>
      <td style="text-align:right">\${fmt(r.close)}</td>
      <td class="\${chgClass(r.changePct)}" style="text-align:right">\${r.changePct!=null?(r.changePct>=0?'+':'')+fmt(r.changePct)+'%':'--'}</td>
      <td style="text-align:right">\${r.rsi!=null?fmt(r.rsi,1):'--'}</td>
      <td style="text-align:right">\${r.marketCap!=null?fmtBig(r.marketCap):'--'}</td>
      <td style="color:#8b949e;font-size:12px">\${r.sector??'--'}</td>
    </tr>\`).join('');
    document.getElementById('screen-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Symbole</th><th>Nom</th><th style="text-align:right">Prix</th><th style="text-align:right">Chg%</th><th style="text-align:right">RSI</th><th style="text-align:right">Cap</th><th>Secteur</th></tr>
        \${rows||'<tr><td colspan=7 class=empty>Aucun résultat</td></tr>'}
      </table></div>\`;
    status(\`\${data.length} valeurs trouvées\`, 'ok');
  } catch(e) { document.getElementById('screen-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── CALENDRIER ECO ────────────────────────────────────────────────────────────

async function loadCalEco() {
  loading('cal-eco-result');
  const params = new URLSearchParams({
    from: document.getElementById('ce-from').value,
    to:   document.getElementById('ce-to').value,
    countries: document.getElementById('ce-ctry').value,
    importance: document.getElementById('ce-imp').value,
  });
  try {
    const data = await api('/api/calendar/eco?'+params);
    const rows = data.map(e => \`<tr>
      <td style="white-space:nowrap">\${e.dateLocal} \${e.timeLocal??''}</td>
      <td><b>\${e.country}</b></td>
      <td>\${e.importanceLabel?'<span class="\${impClass(e.importance)}">\${impLabel(e.importance)}</span>':''}</td>
      <td style="font-weight:600">\${e.title}</td>
      <td style="text-align:right;color:#8b949e">\${e.previous??'--'}</td>
      <td style="text-align:right;color:#58a6ff">\${e.forecast??'--'}</td>
      <td style="text-align:right;font-weight:600">\${e.actual??'--'}</td>
    </tr>\`).join('');
    document.getElementById('cal-eco-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Date / Heure</th><th>Pays</th><th>Importance</th><th>Événement</th><th style="text-align:right">Préc.</th><th style="text-align:right">Prévu</th><th style="text-align:right">Réel</th></tr>
        \${rows||'<tr><td colspan=7 class=empty>Aucun événement</td></tr>'}
      </table></div>\`;
    status(\`\${data.length} événements\`, 'ok');
  } catch(e) { document.getElementById('cal-eco-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── CALENDRIER EARNINGS ───────────────────────────────────────────────────────

async function loadCalEarn() {
  loading('cal-earn-result');
  const mkt = document.getElementById('earn-mkt').value;
  const params = new URLSearchParams({
    from:  document.getElementById('earn-from').value,
    to:    document.getElementById('earn-to').value,
    limit: document.getElementById('earn-lim').value,
  });
  if (mkt) params.set('markets', mkt);
  try {
    const data = await api('/api/calendar/earnings?'+params);
    const rows = data.map(e => \`<tr>
      <td style="white-space:nowrap">\${e.date??'--'}</td>
      <td>\${e.time==='BMO'?'🌅 BMO':e.time==='AMC'?'🌆 AMC':'--'}</td>
      <td style="color:#58a6ff;font-weight:600">\${e.symbol}</td>
      <td>\${e.company??'--'}</td>
      <td style="text-align:right">\${e.epsEstimate!=null?fmt(e.epsEstimate):'--'}</td>
      <td style="text-align:right;\${e.epsSurprisePct>0?'color:#3fb950':e.epsSurprisePct<0?'color:#f85149':''}">\${e.epsSurprisePct!=null?(e.epsSurprisePct>=0?'+':'')+fmt(e.epsSurprisePct)+'%':'--'}</td>
      <td style="text-align:right">\${e.marketCap!=null?fmtBig(e.marketCap):'--'}</td>
      <td>\${e.quarter??'--'}</td>
    </tr>\`).join('');
    document.getElementById('cal-earn-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Date</th><th>Heure</th><th>Symbole</th><th>Société</th><th style="text-align:right">EPS Est.</th><th style="text-align:right">Surprise</th><th style="text-align:right">Cap</th><th>Trimestre</th></tr>
        \${rows||'<tr><td colspan=8 class=empty>Aucun résultat</td></tr>'}
      </table></div>\`;
    status(\`\${data.length} sociétés\`, 'ok');
  } catch(e) { document.getElementById('cal-earn-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}

// ── CALENDRIER DIVIDENDES ─────────────────────────────────────────────────────

async function loadCalDiv() {
  loading('cal-div-result');
  const mkt = document.getElementById('div-mkt').value;
  const params = new URLSearchParams({
    from:  document.getElementById('div-from').value,
    to:    document.getElementById('div-to').value,
    limit: document.getElementById('div-lim').value,
  });
  if (mkt) params.set('markets', mkt);
  try {
    const data = await api('/api/calendar/dividends?'+params);
    const rows = data.map(e => \`<tr>
      <td style="white-space:nowrap">\${e.exDate??'--'}</td>
      <td style="white-space:nowrap;color:#8b949e">\${e.payDate??'--'}</td>
      <td style="color:#58a6ff;font-weight:600">\${e.symbol}</td>
      <td>\${e.company??'--'}</td>
      <td style="text-align:right;color:#3fb950;font-weight:600">\${e.amount!=null?fmt(e.amount,4)+' '+(e.currency??''):'--'}</td>
      <td style="text-align:right">\${e.yield!=null?fmt(e.yield)+'%':'--'}</td>
      <td style="text-align:right">\${e.marketCap!=null?fmtBig(e.marketCap):'--'}</td>
    </tr>\`).join('');
    document.getElementById('cal-div-result').innerHTML = \`
      <div class="table-wrap"><table>
        <tr><th>Ex-Date</th><th>Pay-Date</th><th>Symbole</th><th>Société</th><th style="text-align:right">Dividende</th><th style="text-align:right">Rendement</th><th style="text-align:right">Cap</th></tr>
        \${rows||'<tr><td colspan=7 class=empty>Aucun résultat</td></tr>'}
      </table></div>\`;
    status(\`\${data.length} dividendes\`, 'ok');
  } catch(e) { document.getElementById('cal-div-result').innerHTML = '<div class="empty">❌ '+e.message+'</div>'; status(e.message,'error'); }
}
</script>
</body>
</html>`;
