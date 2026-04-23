'use strict';

/**
 * MODULE 1 — Earnings Calendar + Insider Trades
 * ─────────────────────────────────────────────
 * Sources :
 *   - Calendrier earnings : Nasdaq API (https://api.nasdaq.com/api/calendar/earnings)
 *   - Insider trades      : SEC EDGAR Form 4 (https://data.sec.gov)
 *   - Enrichissement      : TradingView Screener (tv_screener.js)
 *
 * Usage :
 *   node analyze.js candidates --days-min 10 --days-max 25 --market america
 */

const axios   = require('axios');
const xml2js  = require('xml2js');
const fs      = require('fs');
const path    = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT       = path.join(__dirname);
const CACHE_DIR  = path.join(ROOT, 'cache');
const LOGS_DIR   = path.join(ROOT, 'logs');

[CACHE_DIR, LOGS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Logger ───────────────────────────────────────────────────────────────────

function makeLogger(date) {
  const logFile = path.join(LOGS_DIR, `module1_${date}.log`);
  const stream  = fs.createWriteStream(logFile, { flags: 'a' });
  return {
    info  : (...a) => { const m = `[INFO ] ${new Date().toISOString()} ${a.join(' ')}`; stream.write(m + '\n'); },
    warn  : (...a) => { const m = `[WARN ] ${new Date().toISOString()} ${a.join(' ')}`; stream.write(m + '\n'); console.warn('  ⚠', ...a); },
    error : (...a) => { const m = `[ERROR] ${new Date().toISOString()} ${a.join(' ')}`; stream.write(m + '\n'); },
    close : ()     => stream.end(),
  };
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json, text/plain, */*',
  'Origin':     'https://www.nasdaq.com',
  'Referer':    'https://www.nasdaq.com/',
};

const SEC_HEADERS = {
  'User-Agent': 'TradingAnalyzer contact@trading.local',
  'Accept':     'application/json',
};

const SEC_XML_HEADERS = {
  'User-Agent': 'TradingAnalyzer contact@trading.local',
  'Accept':     'application/xml, text/xml, */*',
};

const axiosClient = axios.create({ timeout: 10_000 });

async function fetchWithRetry(url, headers, retries = 2, delayMs = 300) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axiosClient.get(url, { headers });
      return res.data;
    } catch (err) {
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toYMD(d)     { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86_400_000); }
function dateTag()    { return toYMD(new Date()); }

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function cacheGet(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw._ts && (Date.now() - raw._ts) < CACHE_TTL_MS) return raw;
  } catch {}
  return null;
}

function cachePut(file, data) {
  fs.writeFileSync(file, JSON.stringify({ ...data, _ts: Date.now() }, null, 2));
}

// ─── Market cap parser ────────────────────────────────────────────────────────

function parseMarketCapB(str) {
  if (!str || str === '--' || str === 'N/A') return null;
  const s = String(str).replace(/[$,\s]/g, '').toUpperCase();
  if (s.endsWith('T')) return parseFloat(s) * 1000;
  if (s.endsWith('B')) return parseFloat(s);
  if (s.endsWith('M')) return parseFloat(s) / 1000;
  const n = parseFloat(s);
  return isNaN(n) ? null : n / 1e9;
}

function parseReportTime(str) {
  if (!str) return '?';
  const s = String(str).toLowerCase();
  if (s.includes('before') || s.includes('bmo')) return 'BMO';
  if (s.includes('after')  || s.includes('amc')) return 'AMC';
  return '?';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 1 — CALENDRIER EARNINGS (Nasdaq API)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchNasdaqEarnings(dateStr, log) {
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
  log.info(`Nasdaq earnings ${dateStr}`);
  try {
    const data = await fetchWithRetry(url, NASDAQ_HEADERS);
    const rows = data?.data?.rows ?? data?.data?.earnings?.rows ?? [];
    return rows;
  } catch (err) {
    log.warn(`Nasdaq ${dateStr} échoué: ${err.message}`);
    return [];
  }
}

async function getEarningsCandidates({ daysMin, daysMax, minCapB, log }) {
  const today    = new Date();
  const fromDate = addDays(today, daysMin);
  const toDate   = addDays(today, daysMax);

  log.info(`Scan earnings du ${toYMD(fromDate)} au ${toYMD(toDate)}`);

  const all      = [];
  const scannedDates = [];

  let cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const dateStr = toYMD(cursor);
    scannedDates.push(dateStr);

    const rows = await fetchNasdaqEarnings(dateStr, log);

    for (const row of rows) {
      const ticker  = (row.symbol || row.ticker || '').trim().toUpperCase();
      const capB    = parseMarketCapB(row.marketCap);
      const capOk   = capB === null || capB >= minCapB;

      if (!ticker || !capOk) continue;

      const days = daysBetween(today, dateStr);

      all.push({
        ticker,
        company       : row.name || row.companyName || ticker,
        earnings_date : dateStr,
        earnings_in_days : days,
        report_time   : parseReportTime(row.time),
        estimated_eps : parseFloat(row.epsForecast  || row.estimatedEPS)  || null,
        previous_eps  : parseFloat(row.lastYearEPS  || row.previousEPS)   || null,
        market_cap_b  : capB,
        _source       : 'nasdaq',
      });
    }

    cursor = addDays(cursor, 1);
    await sleep(300);
  }

  // Dédoublonner (même ticker peut apparaître plusieurs jours si l'API est floue)
  const seen = new Map();
  for (const c of all) {
    if (!seen.has(c.ticker) || c.earnings_in_days < seen.get(c.ticker).earnings_in_days) {
      seen.set(c.ticker, c);
    }
  }

  log.info(`Earnings: ${scannedDates.length} dates scannées, ${all.length} lignes, ${seen.size} uniques`);
  return { candidates: [...seen.values()], scannedDates };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 2 — INSIDER TRADES (SEC EDGAR Form 4)
// ═══════════════════════════════════════════════════════════════════════════════

const CIK_MAP_FILE = path.join(CACHE_DIR, 'cik_map.json');

async function getCikMap(log) {
  // Cache permanent du CIK map (très stable, mis à jour rarement)
  const cached = cacheGet(CIK_MAP_FILE);
  if (cached) { log.info('CIK map depuis cache'); return cached.map; }

  log.info('Téléchargement CIK map SEC EDGAR...');
  const data = await fetchWithRetry('https://www.sec.gov/files/company_tickers.json', SEC_HEADERS);

  // Normaliser : { TICKER -> cik_str }
  const map = {};
  for (const entry of Object.values(data)) {
    map[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, '0');
  }
  cachePut(CIK_MAP_FILE, { map });
  log.info(`CIK map: ${Object.keys(map).length} entrées`);
  return map;
}

async function getForm4Filings(cik, cutoffDate, log) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  await sleep(200);
  const data = await fetchWithRetry(url, SEC_HEADERS);

  const recent   = data?.filings?.recent ?? {};
  const forms    = recent.form            ?? [];
  const dates    = recent.filingDate      ?? [];
  const accNums  = recent.accessionNumber ?? [];
  const priDocs  = recent.primaryDocument ?? [];

  const cutoff = new Date(cutoffDate);
  const results = [];

  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '4') continue;
    const filingDate = new Date(dates[i]);
    if (filingDate < cutoff) continue;          // Hors fenêtre 45j
    results.push({
      accessionNumber : accNums[i],
      filingDate      : dates[i],
      primaryDocument : priDocs[i],
    });
  }
  return results;
}

async function parseForm4(cik, filing, log) {
  const accNoDashes = filing.accessionNumber.replace(/-/g, '');
  const cikInt      = parseInt(cik);

  // EDGAR renvoie parfois "xslF345X05/form4.xml" — on veut uniquement le nom du fichier XML brut
  let docName = filing.primaryDocument;
  if (docName.includes('/')) docName = docName.split('/').pop();
  // Si le doc n'est pas XML, chercher form4.xml directement
  if (!docName.toLowerCase().endsWith('.xml')) docName = 'form4.xml';

  // Essayer d'abord le fichier tel quel, puis les noms alternatifs courants
  const candidates = [
    docName,
    'form4.xml',
    `${filing.accessionNumber}.txt`,
  ];

  let raw = null;
  let url = '';
  for (const doc of candidates) {
    url = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${doc}`;
    try {
      await sleep(200);
      const res = await axiosClient.get(url, { headers: SEC_XML_HEADERS, timeout: 10_000, responseType: 'text' });
      if (res.data && res.data.includes('<ownershipDocument')) { raw = res.data; break; }
    } catch (err) {
      log.info(`Form4 try ${doc}: ${err.message}`);
    }
  }

  if (!raw) { log.error(`Form4 introuvable pour ${filing.accessionNumber}`); return null; }

  // Extraire le bloc XML (le .txt peut être un SGML enveloppant du XML)
  let xmlStr = raw;
  const xmlMatch = raw.match(/<ownershipDocument[\s\S]*?<\/ownershipDocument>/i);
  if (xmlMatch) xmlStr = xmlMatch[0];

  try {
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
    const doc    = await parser.parseStringPromise(xmlStr);
    const root   = doc?.ownershipDocument;
    if (!root) return null;

    // ─── Identité du déclarant ─────────────────────────────────────────────
    const ro         = root.reportingOwner;
    const roArr      = Array.isArray(ro) ? ro : [ro];
    const owners     = roArr.map(o => ({
      name  : o?.reportingOwnerId?.rptOwnerName  ?? 'Unknown',
      title : o?.reportingOwnerRelationship?.officerTitle
             ?? (o?.reportingOwnerRelationship?.isDirector === '1' ? 'Director' : 'Unknown'),
    }));

    // ─── Détection plan 10b5-1 ────────────────────────────────────────────
    const is10b5 = raw.toLowerCase().includes('10b5-1') || raw.toLowerCase().includes('10b5');

    // ─── Transactions non-dérivées ────────────────────────────────────────
    const ndTable = root.nonDerivativeTable;
    if (!ndTable) return null;

    const txArr = Array.isArray(ndTable.nonDerivativeTransaction)
      ? ndTable.nonDerivativeTransaction
      : ndTable.nonDerivativeTransaction ? [ndTable.nonDerivativeTransaction] : [];

    if (!txArr.length) return null;

    const trades = [];
    for (const tx of txArr) {
      const code    = tx?.transactionCoding?.transactionCode ?? '';
      const shares  = parseFloat(tx?.transactionAmounts?.transactionShares?.value)         ?? 0;
      const price   = parseFloat(tx?.transactionAmounts?.transactionPricePerShare?.value)  ?? 0;
      const date    = tx?.transactionDate?.value ?? filing.filingDate;
      const total   = shares * price;

      trades.push({ code, shares, price, date, total, is10b5, owners });
    }

    return trades;
  } catch (err) {
    log.error(`Form4 parse ${url}: ${err.message}`);
    return null;
  }
}

function filterInsiderTrades(rawTrades) {
  const qualified = [];
  for (const trade of rawTrades) {
    if (trade.code !== 'P')   continue;   // Garder achats uniquement
    if (trade.is10b5)         continue;   // Ignorer plans préétablis
    if (trade.total < 25_000) continue;   // Ignorer achats < 25k$
    if (trade.code === 'A')   continue;   // Ignorer attributions options
    qualified.push(trade);
  }
  return qualified;
}

function classifySignal(trades) {
  if (!trades.length) return 'NONE';

  // Cluster : 2+ insiders différents dans 14 jours
  const sorted = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (let i = 0; i < sorted.length - 1; i++) {
    const d1 = new Date(sorted[i].date);
    const d2 = new Date(sorted[i + 1].date);
    if ((d2 - d1) / 86_400_000 <= 14) return 'CLUSTER';
  }
  return 'SINGLE';
}

async function getInsiderTrades(ticker, cikMap, log) {
  const cik = cikMap[ticker];
  if (!cik) { log.warn(`CIK introuvable pour ${ticker}`); return []; }

  const cutoffDate = toYMD(addDays(new Date(), -45));

  let filings;
  try {
    filings = await getForm4Filings(cik, cutoffDate, log);
  } catch (err) {
    log.error(`Submissions ${ticker}: ${err.message}`);
    return [];
  }

  if (!filings.length) return [];
  log.info(`${ticker}: ${filings.length} Form4 trouvé(s)`);

  const allRaw = [];
  for (const filing of filings.slice(0, 10)) {   // Max 10 Form4 par ticker
    const trades = await parseForm4(cik, filing, log);
    if (trades) allRaw.push(...trades);
  }

  return filterInsiderTrades(allRaw).map(t => ({
    name        : t.owners[0]?.name  ?? 'Unknown',
    title       : t.owners[0]?.title ?? 'Unknown',
    type        : 'P',
    date        : t.date,
    shares      : Math.round(t.shares),
    price       : t.price,
    total_value : Math.round(t.total),
    is_10b5     : t.is10b5,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 3 — ENRICHISSEMENT (TradingView Screener)
// ═══════════════════════════════════════════════════════════════════════════════

async function enrichCandidates(candidates, log) {
  if (!candidates.length) return candidates;

  const { TVScreener } = require('./tv_screener');
  const tickers = candidates.map(c => c.ticker);
  log.info(`Enrichissement de ${tickers.length} tickers via TradingView`);

  try {
    const screener = new TVScreener('america').limit(500)
      .select('close', 'market_cap_basic', 'average_volume_10d_calc',
              'volume', 'beta_1_year', 'change')
      .sortBy('market_cap_basic', 'desc');

    const results = await screener.run();
    const bySymbol = {};
    for (const r of results) {
      // Le screener renvoie _symbol = "NASDAQ:AAPL", on extrait "AAPL"
      const sym = (r._symbol ?? '').split(':').pop().toUpperCase();
      if (sym) bySymbol[sym] = r;
    }

    log.info(`Screener: ${results.length} résultats, ${Object.keys(bySymbol).length} symboles indexés`);

    return candidates.map(c => {
      const r = bySymbol[c.ticker];
      if (!r) return c;
      return {
        ...c,
        price          : r.close              ?? c.price,
        market_cap_b   : r.marketCap != null  ? r.marketCap / 1e9 : c.market_cap_b,
        avg_volume_20d : Math.round(r.avgVolume10 ?? r.volume ?? 0),
        beta           : r.beta               ?? null,
      };
    });
  } catch (err) {
    log.warn(`Enrichissement TradingView échoué: ${err.message}`);
    return candidates;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 4 — SCORING MODULE 1
// ═══════════════════════════════════════════════════════════════════════════════

function scoreCandidate(candidate) {
  let score = 0;
  const reasons = [];

  // ─── Timing earnings ──────────────────────────────────────────────────────
  const d = candidate.earnings_in_days;
  if (d >= 12 && d <= 20) { score += 1; reasons.push('fenêtre idéale (12-20j)'); }
  else if (d >= 10 && d <= 25) { score += 0; reasons.push('fenêtre acceptable (10-25j)'); }

  // ─── Signal insider ───────────────────────────────────────────────────────
  const sig = candidate.insider_signal;
  const big  = (candidate.insider_trades ?? []).some(t => t.total_value >= 50_000);
  if (sig === 'CLUSTER') { score += 2; reasons.push('cluster insiders'); }
  else if (sig === 'SINGLE' && big) { score += 1; reasons.push('achat insider > 50k$'); }

  return { score, reasons };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AFFICHAGE CONSOLE
// ═══════════════════════════════════════════════════════════════════════════════

const C = {
  reset : '\x1b[0m',   bold  : '\x1b[1m',
  green : '\x1b[32m',  cyan  : '\x1b[36m',
  yellow: '\x1b[33m',  red   : '\x1b[31m',
  dim   : '\x1b[2m',   white : '\x1b[37m',
};

function fmt$(n) { return n != null ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--'; }
function fmtB(n) { return n != null ? `${n.toFixed(1)}B$` : '--'; }

function printReport(output, stats) {
  const SEP = '═'.repeat(56);
  const sep = '─'.repeat(56);

  console.log(`\n${C.bold}${C.cyan}${SEP}${C.reset}`);
  console.log(`${C.bold}  MODULE 1 — CANDIDATS EARNINGS + INSIDER TRADES${C.reset}`);
  console.log(`  Généré le : ${stats.generatedAt} | Fenêtre : J+${stats.daysMin} à J+${stats.daysMax}`);
  console.log(`${C.bold}${C.cyan}${SEP}${C.reset}`);
  console.log();
  console.log(`  Earnings scannés    : ${stats.scannedDates} dates`);
  console.log(`  Titres trouvés      : ${stats.totalFound}`);
  console.log(`  Après filtre cap    : ${stats.afterCapFilter}`);
  console.log(`  Après filtre insider: ${stats.afterInsiderFilter}`);
  console.log(`${C.cyan}${SEP}${C.reset}`);

  const passed = output.filter(c => c.module1_pass);
  const failed = output.filter(c => !c.module1_pass);

  if (passed.length) {
    console.log(`\n${C.bold}${C.green}✅ CANDIDATS RETENUS (score ≥ 1)${C.reset}\n`);
    for (const c of passed) {
      const dColor = c.earnings_in_days >= 12 && c.earnings_in_days <= 20 ? C.green : C.yellow;
      const sigColor = c.insider_signal === 'CLUSTER' ? C.green : c.insider_signal === 'SINGLE' ? C.yellow : C.dim;

      console.log(`${C.bold}${C.white}  ${c.ticker}${C.reset} — ${c.company}`);
      console.log(`  Earnings    : ${dColor}${c.earnings_date} (${c.earnings_in_days}j)${C.reset} — ${c.report_time}`);
      if (c.estimated_eps != null)
        console.log(`  EPS estimé  : ${c.estimated_eps} vs ${c.previous_eps ?? '--'} précédent`);
      console.log(`  Cap         : ${fmtB(c.market_cap_b)}  |  Beta : ${c.beta?.toFixed(2) ?? '--'}  |  Vol20: ${c.avg_volume_20d?.toLocaleString() ?? '--'}`);
      console.log(`  Insider     : ${sigColor}${c.insider_signal}${C.reset}`);

      for (const t of c.insider_trades ?? []) {
        console.log(`  ${C.dim}└─ ${t.name} (${t.title}) — Achat ${t.shares.toLocaleString()} actions`);
        console.log(`     @ ${fmt$(t.price)} = ${fmt$(t.total_value)} le ${t.date}${C.reset}`);
      }
      console.log(`  Score M1    : ${C.bold}${c.module1_score}/4${C.reset}  (${c.module1_reasons.join(', ')})`);
      console.log();
    }
  }

  if (failed.length) {
    console.log(`${C.dim}${sep}${C.reset}`);
    console.log(`${C.bold}${C.red}❌ ÉLIMINÉS${C.reset}\n`);
    for (const c of failed) {
      const reasons = [];
      if (c.module1_score === 0) {
        if (!c.insider_trades?.length) reasons.push('aucun insider signal');
        if (c.earnings_in_days < 10 || c.earnings_in_days > 25) reasons.push('hors fenêtre');
        if ((c.market_cap_b ?? 0) < 5) reasons.push('cap trop faible');
      }
      console.log(`  ${C.dim}${c.ticker.padEnd(8)} — Raison : ${reasons.join(' | ') || 'score = 0'}${C.reset}`);
    }
  }

  console.log(`\n${C.cyan}${SEP}${C.reset}`);
  console.log(`${C.bold}  → ${passed.length} candidat(s) transmis au MODULE 2${C.reset}`);
  console.log(`  Cache sauvegardé : ./cache/candidates_${stats.date}.json`);
  console.log(`  Log              : ./logs/module1_${stats.date}.log`);
  console.log(`${C.cyan}${SEP}${C.reset}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function runCandidates({
  daysMin  = 10,
  daysMax  = 25,
  market   = 'america',
  minCapB  = 5,
  output   = 'console',
} = {}) {
  const date = dateTag();
  const log  = makeLogger(date);

  // ─── Cache check ──────────────────────────────────────────────────────────
  const cacheFile = path.join(CACHE_DIR, `candidates_${date}.json`);
  const cached    = cacheGet(cacheFile);
  if (cached) {
    log.info('Résultats depuis cache (< 12h)');
    if (output === 'console') printReport(cached.candidates, cached.stats);
    if (output === 'json')    console.log(JSON.stringify(cached, null, 2));
    log.close();
    return cached;
  }

  log.info(`Démarrage MODULE 1 | J+${daysMin} à J+${daysMax} | cap > ${minCapB}B$`);

  const stats = {
    generatedAt     : new Date().toISOString(),
    date,
    daysMin, daysMax, minCapB, market,
    scannedDates    : 0,
    totalFound      : 0,
    afterCapFilter  : 0,
    afterInsiderFilter : 0,
  };

  // ─── 1. Calendrier earnings ──────────────────────────────────────────────
  process.stdout.write('\n  ⏳ Fetching earnings calendar...\r');
  const { candidates: rawCandidates, scannedDates } = await getEarningsCandidates({
    daysMin, daysMax, minCapB, log,
  });

  stats.scannedDates   = scannedDates.length;
  stats.totalFound     = rawCandidates.length;
  stats.afterCapFilter = rawCandidates.length;
  process.stdout.write(`  ✅ Earnings : ${rawCandidates.length} titres trouvés dans la fenêtre         \n`);

  if (!rawCandidates.length) {
    log.warn('Aucun candidat earnings trouvé — arrêt');
    log.close();
    return { candidates: [], stats };
  }

  // ─── 2. Insider trades ───────────────────────────────────────────────────
  process.stdout.write(`  ⏳ Fetching SEC EDGAR insiders (${rawCandidates.length} tickers)...\r`);
  const cikMap = await getCikMap(log);

  const enrichedWithInsiders = [];
  for (let i = 0; i < rawCandidates.length; i++) {
    const c = rawCandidates[i];
    process.stdout.write(`  ⏳ Insider [${i + 1}/${rawCandidates.length}] ${c.ticker.padEnd(8)}\r`);
    try {
      const trades = await getInsiderTrades(c.ticker, cikMap, log);
      enrichedWithInsiders.push({
        ...c,
        insider_trades : trades,
        insider_signal : classifySignal(trades),
      });
    } catch (err) {
      log.error(`Insider ${c.ticker}: ${err.message}`);
      enrichedWithInsiders.push({ ...c, insider_trades: [], insider_signal: 'NONE' });
    }
  }
  process.stdout.write(`  ✅ Insider trades récupérés                                     \n`);

  // ─── 3. Enrichissement TradingView ───────────────────────────────────────
  process.stdout.write('  ⏳ Enrichissement TradingView...\r');
  const enriched = await enrichCandidates(enrichedWithInsiders, log);
  process.stdout.write('  ✅ Enrichissement terminé                       \n');

  // ─── 4. Scoring ──────────────────────────────────────────────────────────
  const scored = enriched.map(c => {
    const { score, reasons } = scoreCandidate(c);
    return {
      ...c,
      module1_score   : score,
      module1_reasons : reasons,
      module1_pass    : score >= 1,
    };
  });

  // Trier : passés en premier, puis par score décroissant
  scored.sort((a, b) => {
    if (a.module1_pass !== b.module1_pass) return b.module1_pass - a.module1_pass;
    return b.module1_score - a.module1_score;
  });

  stats.afterInsiderFilter = scored.filter(c => c.module1_pass).length;

  // ─── Sauvegarde cache ────────────────────────────────────────────────────
  const result = { generated_at: stats.generatedAt, stats, candidates: scored };
  cachePut(cacheFile, result);
  log.info(`Cache sauvegardé: ${cacheFile}`);

  // ─── Sortie ───────────────────────────────────────────────────────────────
  if (output === 'console') printReport(scored, stats);
  if (output === 'json')    console.log(JSON.stringify(result, null, 2));
  if (output === 'file')    console.log(`Résultats dans ${cacheFile}`);

  log.close();
  return result;
}

module.exports = { runCandidates };
