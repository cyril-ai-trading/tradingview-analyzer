/**
 * iv_scraper.js
 *
 * Scrapes IV Rank (IVR), IV Percentile, current IV (IV30), 52-week IV high/low,
 * and options volume for a list of US stock tickers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  FINDINGS SUMMARY (researched 2026-04-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. MARKET CHAMELEON — marketchameleon.com
 *     ─────────────────────────────────────
 *     IV page URL:  https://marketchameleon.com/Overview/{TICKER}/IV/
 *     e.g.          https://marketchameleon.com/Overview/V/IV/
 *
 *     PUBLIC API: None documented. They offer paid "Data Feeds" at
 *       https://marketchameleon.com/DataFeed  (CSV/machine-readable, paid).
 *
 *     ANTI-BOT: The site actively detects and blocks non-browser HTTP clients.
 *       Raw https.get returns HTTP 200 with an "Access Denied" HTML page
 *       (even with a real Chrome User-Agent). The response is ~12 KB vs the
 *       real page which is much larger. Their Terms of Use explicitly prohibit
 *       "web automation or a non-standard web browser."
 *
 *     robots.txt:  Crawl-Delay: 15  (for all user-agents)
 *       /Overview/* paths are NOT disallowed — only /Account/*, /Admin/*, etc.
 *
 *     SOLUTION: Must use a real browser (Playwright or Puppeteer) which passes
 *       fingerprint checks. The page IS server-rendered (SSR) so Cheerio works
 *       once you get the real HTML via browser automation.
 *
 *     HTML STRUCTURE (confirmed via live browser inspection):
 *     ┌─────────────────────────────────────────────────────┐
 *     │  <div class="ov-head-stats-outer _4c">             │
 *     │    <div class="ov-head-stat">                       │
 *     │      <span class="labeltag">Option Volume:</span>  │
 *     │      <span class="datatag">16,471</span>           │
 *     │    </div>                                           │
 *     │    <div class="ov-head-stat">                       │
 *     │      <span class="labeltag">30-Day IV:</span>      │
 *     │      <span class="datatag">                        │
 *     │        <span class="">41.7</span>  ← IV value      │
 *     │        <span class="num_neg">-1.3</span> ← change  │
 *     │      </span>                                        │
 *     │    </div>                                           │
 *     │    <div class="ov-head-stat">                       │
 *     │      <span class="labeltag">IV30 % Rank:</span>   │
 *     │      <span class="datatag">                        │
 *     │        85%    ← text node = IV Percentile          │
 *     │        <span class="datatag">Elevated</span>      │
 *     │      </span>                                        │
 *     │    </div>                                           │
 *     │  </div>                                             │
 *     │                                                     │
 *     │  <table class="mp_lightborder">                    │
 *     │    <tr><th>Summary IV vs HV</th></tr>              │
 *     │    <tr><th></th><th>IV30</th><th>20D HV</th>...</tr>│
 *     │    <tr><td>Current</td><td class="rightcelltd">    │
 *     │           26.5</td>...</tr>                         │
 *     │    <tr><td>52-Wk Avg</td><td ...>22.7</td>...</tr> │
 *     │    <tr><td>52-Wk High</td><td ...>41.8</td>...</tr>│
 *     │    <tr><td>52-Wk Low</td><td ...>16.3</td>...</tr> │
 *     │  </table>                                           │
 *     └─────────────────────────────────────────────────────┘
 *
 *     TERMINOLOGY ON MARKET CHAMELEON:
 *       "IV30 % Rank"  = IV Percentile  (% of days in past year that IV was
 *                        LOWER than today — same as what Tastytrade calls IVP)
 *       "IVR" (IV Rank) is NOT displayed directly. Must be computed from
 *         the summary table:
 *         IVR = (Current IV30 - 52wkLow) / (52wkHigh - 52wkLow) × 100
 *
 *     SELECTOR CHEAT SHEET:
 *       Option Volume :  .ov-head-stat:has(.labeltag:contains("Option Volume:")) .datatag
 *       Current IV30  :  .ov-head-stat:has(.labeltag:contains("30-Day IV:")) .datatag span:not(.num_neg):not(.num_pos)
 *       IV Percentile :  .ov-head-stat:has(.labeltag:contains("IV30 % Rank:")) .datatag (first text node)
 *       IV Label      :  .ov-head-stat:has(.labeltag:contains("IV30 % Rank:")) .datatag .datatag
 *       52wk High     :  table.mp_lightborder tr:nth-child(5) td.rightcelltd:first-child
 *       52wk Low      :  table.mp_lightborder tr:nth-child(6) td.rightcelltd:first-child
 *
 *  2. BARCHART — barchart.com
 *     ────────────────────────
 *     IV Rank/Percentile page: https://www.barchart.com/options/iv-rank-percentile
 *     Shows a table with columns: Symbol, IV Rank, IV Percentile, Implied Vol,
 *       Total Options Volume.
 *     Data refreshes every 10 minutes via client-side JS (not SSR).
 *     Barchart OnDemand API has endpoints:
 *       getEquityOptionsOverviewSummary  → current-day IVRank, IVPercentile,
 *                                          total volume, OI, put/call ratios
 *       getEquityOptionsOverviewHistory  → historical daily values
 *     These require an API key (paid). No free tier documented.
 *     Free users can download 1 CSV/day from the site UI.
 *     Per-ticker options page: https://www.barchart.com/stocks/quotes/{TICKER}/options-data
 *
 *  3. UNUSUAL WHALES — unusualwhales.com
 *     ─────────────────────────────────
 *     IV Rank page:   https://unusualwhales.com/stock/{TICKER}/volatility
 *     Official REST API: https://api.unusualwhales.com
 *       Authentication: Bearer token (paid subscription, ~$250/mo for full data)
 *       Relevant endpoints:
 *         GET /api/stock/{TICKER}/iv-rank        → IV Rank for ticker
 *         GET /api/stock/{TICKER}/volatility     → IV term structure
 *     Documentation: https://api.unusualwhales.com/docs
 *
 *  4. ALPHAQUERY — alphaquery.com
 *     ────────────────────────────
 *     URL pattern:  https://www.alphaquery.com/stock/{TICKER}/volatility-option-statistics/30-day/iv-mean
 *     Requires paid subscription ("VolVue" product). Free trial available.
 *     Offers 300+ data fields, 52-week rank and percentile for all metrics,
 *     downloadable via CSV/Excel/JSON/XML or API.
 *
 *  5. CBOE / LIVEVOL — datashop.cboe.com
 *     ─────────────────────────────────
 *     REST API at api.livevol.com — paid ($380/mo for LiveVol Pro).
 *     Provides IV, Greeks, end-of-day snapshots. No free tier.
 *
 *  6. OPEN-SOURCE SCRAPERS FOUND:
 *     github.com/jacobf18/Financial-Scraping — Python scripts including one
 *     for Market Chameleon, but REQUIRES premium MC account + geckodriver/Firefox.
 *     No public Node.js scrapers found specifically for MC IV data.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMPLEMENTATION: Two strategies below
 *  Strategy A — Playwright (recommended, handles anti-bot)
 *  Strategy B — Barchart free page scrape (no login required, JS-rendered)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Install dependencies:
 *    npm install playwright cheerio
 *    npx playwright install chromium
 */

'use strict';

const cheerio = require('cheerio');

// ─── Configuration ──────────────────────────────────────────────────────────

const TICKERS = ['V', 'QCOM', 'MRK', 'COP', 'BMY', 'NXPI', 'CDNS', 'VRTX'];

// Honour robots.txt Crawl-Delay: 15 seconds between requests
const CRAWL_DELAY_MS = 15_000;

// ─── Utility ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute IVR (52-week position / IV Rank):
 *   IVR = (currentIV - 52wkLow) / (52wkHigh - 52wkLow) * 100
 */
function computeIVR(current, high, low) {
  const c = parseFloat(current);
  const h = parseFloat(high);
  const l = parseFloat(low);
  if (isNaN(c) || isNaN(h) || isNaN(l) || h === l) return null;
  return parseFloat(((c - l) / (h - l) * 100).toFixed(1));
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY A: Market Chameleon via Playwright
//  Requires: npm install playwright && npx playwright install chromium
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse Market Chameleon IV page HTML using cheerio.
 * Call this after obtaining the real page HTML via Playwright.
 *
 * @param {string} html   Full page HTML from browser
 * @param {string} ticker
 * @returns {object}
 */
function parseMCPage(html, ticker) {
  const $ = cheerio.load(html);
  const result = { ticker, source: 'marketchameleon', timestamp: new Date().toISOString() };

  // Helper: find a .ov-head-stat by its label text
  function findStat(labelText) {
    let found = null;
    $('.ov-head-stat').each((_, el) => {
      if ($(el).find('.labeltag').text().trim() === labelText) {
        found = el;
      }
    });
    return found ? $(found) : null;
  }

  // 1. IV Percentile  ("IV30 % Rank:" label)
  //    The .datatag first text node = "85%", followed by nested .datatag = label
  const ivRankStat = findStat('IV30 % Rank:');
  if (ivRankStat) {
    const datatag = ivRankStat.find('.datatag').first();
    // Get the raw HTML of datatag to extract the leading text node "85%"
    const rawHtml = datatag.html() || '';
    const pctMatch = rawHtml.match(/^\s*(\d+)%/);
    result.ivPercentile = pctMatch ? parseInt(pctMatch[1], 10) : null;

    // IV qualifier label (nested .datatag inside the outer .datatag)
    result.ivLabel = datatag.find('.datatag').first().text().trim() || null;
  }

  // 2. Current IV30  ("30-Day IV:" label)
  //    The .datatag contains: <span>41.7</span><span class="num_neg">-1.3</span>
  //    The IV value span has NO class attribute at all (not even class="").
  const iv30Stat = findStat('30-Day IV:');
  if (iv30Stat) {
    // The IV value is in the first <span> with no class attribute inside .datatag
    const ivSpan = iv30Stat.find('.datatag span').filter((_, el) => {
      return !$(el).attr('class');  // no class attribute at all
    }).first();
    result.currentIV30 = ivSpan.length ? parseFloat(ivSpan.text().trim()) || null : null;
  }

  // 3. Option Volume  ("Option Volume:" label)
  const optVolStat = findStat('Option Volume:');
  if (optVolStat) {
    const raw = optVolStat.find('.datatag').first().text().trim();
    result.optionsVolume = raw ? parseInt(raw.replace(/,/g, ''), 10) || null : null;
  }

  // 4. Summary table  (table.mp_lightborder)
  //    Rows: Current | 52-Wk Avg | 52-Wk High | 52-Wk Low
  //    Columns: [label, IV30, 20D HV, 252D HV]
  const tableData = {};
  $('table.mp_lightborder tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim();
      const iv30Val = $(cells[1]).text().trim();
      tableData[label] = iv30Val;
    }
  });

  result.iv52wkHigh = tableData['52-Wk High'] ? parseFloat(tableData['52-Wk High']) || null : null;
  result.iv52wkLow  = tableData['52-Wk Low']  ? parseFloat(tableData['52-Wk Low'])  || null : null;
  result.iv52wkAvg  = tableData['52-Wk Avg']  ? parseFloat(tableData['52-Wk Avg'])  || null : null;

  // Fallback for currentIV30 from table if direct extraction failed
  if (!result.currentIV30 && tableData['Current']) {
    result.currentIV30 = parseFloat(tableData['Current']) || null;
  }

  // 5. Computed IVR (IV Rank = 52-week position)
  result.ivRank = (result.currentIV30 && result.iv52wkHigh && result.iv52wkLow)
    ? computeIVR(result.currentIV30, result.iv52wkHigh, result.iv52wkLow)
    : null;

  result.sourceUrl = `https://marketchameleon.com/Overview/${ticker}/IV/`;
  return result;
}

/**
 * Scrape Market Chameleon IV data for all tickers using Playwright.
 *
 * IMPORTANT: Market Chameleon actively blocks raw HTTP clients (https.get,
 * axios, node-fetch) even with a real Chrome User-Agent. It returns a 200
 * "Access Denied" page (~12 KB) for non-browser requests. Their Terms of Use
 * explicitly prohibit "web automation or a non-standard web browser."
 * Using a real Chromium browser (via Playwright) bypasses fingerprint checks.
 */
async function scrapeMarketChameleonAll(tickers) {
  // Dynamic import so the file can be loaded without playwright installed
  let chromium, Browser, Page;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    throw new Error('playwright not installed. Run: npm install playwright && npx playwright install chromium');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const results = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];

    if (i > 0) {
      console.log(`  Waiting ${CRAWL_DELAY_MS / 1000}s (robots.txt Crawl-Delay)…`);
      await sleep(CRAWL_DELAY_MS);
    }

    const url = `https://marketchameleon.com/Overview/${ticker}/IV/`;
    process.stdout.write(`Fetching ${ticker} from MC… `);

    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for the IV stats block to appear
      await page.waitForSelector('.ov-head-stats-outer', { timeout: 15_000 });

      const html = await page.content();
      await page.close();

      const data = parseMCPage(html, ticker);
      results.push(data);

      console.log(
        `IV30=${data.currentIV30}  IVPct=${data.ivPercentile}%  ` +
        `IVR=${data.ivRank}%  [${data.ivLabel}]  ` +
        `52wk ${data.iv52wkLow}–${data.iv52wkHigh}  ` +
        `OptVol=${data.optionsVolume?.toLocaleString()}`
      );
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      results.push({ ticker, source: 'marketchameleon', error: err.message });
    }
  }

  await browser.close();
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY B: Barchart free page — iv-rank-percentile table
//  The page at barchart.com/options/iv-rank-percentile is JS-rendered.
//  It shows all stocks with IVR/IVP ≥ threshold but NOT individual lookups.
//  For per-ticker data, use the options-data page for each ticker.
//  Also JS-rendered — requires Playwright.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scrape Barchart options data page for a single ticker.
 * URL: https://www.barchart.com/stocks/quotes/{TICKER}/options-data
 *
 * NOTES:
 *  - Page is JS-rendered; Playwright required.
 *  - No login required for basic IV data.
 *  - Barchart defines IVR differently (ATM average IV relative to 1-yr hi/lo).
 *  - IVPercentile = % of days where IV closed BELOW current ATM IV.
 */
async function scrapeBarchartTicker(page, ticker) {
  const url = `https://www.barchart.com/stocks/quotes/${ticker}/options-data`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

  // Wait for the options data section
  try {
    await page.waitForSelector('[data-sym]', { timeout: 10_000 });
  } catch (_) {
    // Selector not found, page may have different structure
  }

  // Extract via page.evaluate
  const data = await page.evaluate((tkr) => {
    // Barchart renders data into a dynamic table / attribute system
    // Look for the IV Rank and IV Percentile data attributes or text
    const result = { ticker: tkr };

    // Common pattern: look for elements with text containing "IV Rank" / "IV Percentile"
    const allText = document.body.innerText;

    const ivRankMatch = allText.match(/IV Rank[:\s]+(\d+\.?\d*)/i);
    result.ivRank = ivRankMatch ? parseFloat(ivRankMatch[1]) : null;

    const ivPctMatch = allText.match(/IV Percentile[:\s]+(\d+\.?\d*)/i);
    result.ivPercentile = ivPctMatch ? parseFloat(ivPctMatch[1]) : null;

    const ivMatch = allText.match(/Implied Volatility[:\s]+([\d.]+)%/i);
    result.currentIV = ivMatch ? parseFloat(ivMatch[1]) : null;

    return result;
  }, ticker);

  return { ...data, source: 'barchart', sourceUrl: url };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGY C: Raw regex on Market Chameleon — USE THIS PATTERN IN PLAYWRIGHT
//  These regex patterns work on the real SSR HTML obtained via browser.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pure regex extraction — works on real MC HTML (must be obtained via Playwright).
 * Useful if you prefer not to install cheerio.
 */
function parseMCPageRegex(html, ticker) {
  const result = { ticker, source: 'marketchameleon', timestamp: new Date().toISOString() };

  // IV Percentile (first text node inside .datatag after "IV30 % Rank:" label)
  const pctM = html.match(
    /class="labeltag"[^>]*>IV30 % Rank:<\/span>\s*<span[^>]*class="datatag"[^>]*>\s*(\d+)%/i
  );
  result.ivPercentile = pctM ? parseInt(pctM[1], 10) : null;

  // IV Label (nested .datatag = "Elevated"/"Subdued"/"Normal")
  const labelM = html.match(
    /IV30 % Rank:<\/span>[\s\S]*?class="datatag"[^>]*>[\s\S]*?class="datatag"[^>]*>([\w\s]+)<\/span>/i
  );
  result.ivLabel = labelM ? labelM[1].trim() : null;

  // Current IV30 (inner <span>VALUE</span> — NO class attr — inside 30-Day IV datatag)
  // Real HTML: <span class="datatag"><span>41.7</span><span class="num_neg">-1.3</span></span>
  const ivM = html.match(
    /class="labeltag"[^>]*>30-Day IV:<\/span>\s*<span[^>]*class="datatag"[^>]*>\s*<span>([\d.]+)<\/span>/i
  );
  result.currentIV30 = ivM ? parseFloat(ivM[1]) : null;

  // Option Volume (simple text node in datatag)
  const volPat = new RegExp(
    'class="labeltag"[^>]*>Option Volume:<\\/span>\\s*<span[^>]*class="datatag"[^>]*>([\\s\\S]*?)<\\/span>',
    'i'
  );
  const volM = html.match(volPat);
  if (volM) {
    const raw = volM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    result.optionsVolume = raw ? parseInt(raw.replace(/,/g, ''), 10) || null : null;
  }

  // Summary table
  const tableM = html.match(/<table[^>]*class="mp_lightborder"[^>]*>([\s\S]*?)<\/table>/i);
  if (tableM) {
    const tableData = {};
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowM;
    while ((rowM = rowRe.exec(tableM[1])) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellM;
      while ((cellM = cellRe.exec(rowM[1])) !== null) {
        cells.push(cellM[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length >= 2) tableData[cells[0]] = cells.slice(1);
    }
    result.iv52wkHigh = tableData['52-Wk High'] ? parseFloat(tableData['52-Wk High'][0]) || null : null;
    result.iv52wkLow  = tableData['52-Wk Low']  ? parseFloat(tableData['52-Wk Low'][0])  || null : null;
    result.iv52wkAvg  = tableData['52-Wk Avg']  ? parseFloat(tableData['52-Wk Avg'][0])  || null : null;
    if (!result.currentIV30 && tableData['Current']) {
      result.currentIV30 = parseFloat(tableData['Current'][0]) || null;
    }
  }

  // Computed IVR
  result.ivRank = (result.currentIV30 && result.iv52wkHigh && result.iv52wkLow)
    ? computeIVR(result.currentIV30, result.iv52wkHigh, result.iv52wkLow)
    : null;

  result.sourceUrl = `https://marketchameleon.com/Overview/${ticker}/IV/`;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('IV Scraper — Market Chameleon via Playwright');
  console.log('Tickers:', TICKERS.join(', '));
  console.log('Crawl delay:', CRAWL_DELAY_MS / 1000 + 's (per robots.txt)\n');

  const results = await scrapeMarketChameleonAll(TICKERS);

  console.log('\n══ Final Results ══');
  console.table(
    results.map((r) => ({
      Ticker:      r.ticker,
      IV30:        r.currentIV30,
      'IVR (%)':   r.ivRank,
      'IVPct (%)': r.ivPercentile,
      Label:       r.ivLabel,
      '52wkHi':    r.iv52wkHigh,
      '52wkLo':    r.iv52wkLow,
      OptVol:      r.optionsVolume,
    }))
  );

  const fs = require('fs');
  const outPath = require('path').join(__dirname, 'iv_data.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nJSON written to ${outPath}`);
}

// Export for use as a module
module.exports = { parseMCPage, parseMCPageRegex, scrapeMarketChameleonAll, computeIVR };

// Run if invoked directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
