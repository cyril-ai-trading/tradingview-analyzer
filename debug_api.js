/**
 * Debug: explore what TradingView exposes in the page JS context
 * node debug_api.js
 */
const { TradingViewCDP } = require('./market_analyzer');

const cdp = new TradingViewCDP('localhost', 9222);

(async () => {
  await cdp.connect();

  // 1. Find TV-related globals
  const tvGlobals = await cdp.eval(`
    (function() {
      const out = [];
      for (const k of Object.keys(window)) {
        const lower = k.toLowerCase();
        if (lower.includes('tv') || lower.includes('chart') || lower.includes('widget') ||
            lower.includes('trading') || lower.includes('datafeed') || lower.includes('broker')) {
          try { out.push({ key: k, type: typeof window[k] }); } catch(_) {}
        }
      }
      return out;
    })()
  `);
  console.log('\n=== TV-related globals ===');
  console.log(JSON.stringify(tvGlobals, null, 2));

  // 2. Try to find the widget and check available methods
  const widgetInfo = await cdp.eval(`
    (function() {
      // Try common names
      const candidates = ['tvWidget', 'TradingViewApi', '__tv_widget', '_tvWidget'];
      for (const name of candidates) {
        if (window[name] && typeof window[name].activeChart === 'function') {
          const chart = window[name].activeChart();
          return {
            found: name,
            chartMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(chart)).filter(m => typeof chart[m] === 'function'),
            symbol: chart.symbol(),
          };
        }
      }
      // Scan all globals
      for (const k of Object.keys(window)) {
        try {
          const v = window[k];
          if (v && typeof v === 'object' && typeof v.activeChart === 'function') {
            const chart = v.activeChart();
            return {
              found: k,
              chartMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(chart)).filter(m => typeof chart[m] === 'function').slice(0, 40),
              symbol: chart.symbol(),
            };
          }
        } catch(_) {}
      }
      return { found: null };
    })()
  `);
  console.log('\n=== Widget & chart methods ===');
  console.log(JSON.stringify(widgetInfo, null, 2));

  // 3. Try to get quote data via TradingView's quote API
  const quoteData = await cdp.eval(`
    (function() {
      // TradingView stores quote data in various places
      const results = {};

      // Try window.quoteData or similar
      for (const k of ['quoteData', 'quotes', '_quotes', 'quotesCache', 'symbolData']) {
        if (window[k]) results[k] = typeof window[k];
      }

      // Try accessing via the chart's series
      try {
        for (const k of Object.keys(window)) {
          const v = window[k];
          if (v && typeof v.activeChart === 'function') {
            const chart = v.activeChart();
            const sym = chart.symbol();
            results.currentSymbol = sym;
            // Try exportData
            if (typeof chart.exportData === 'function') {
              results.hasExportData = true;
            }
            // Try getVisibleRange
            if (typeof chart.getVisibleRange === 'function') {
              results.visibleRange = chart.getVisibleRange();
            }
            break;
          }
        }
      } catch(e) { results.error = e.message; }

      return results;
    })()
  `);
  console.log('\n=== Quote data availability ===');
  console.log(JSON.stringify(quoteData, null, 2));

  cdp.disconnect();
})().catch(console.error);
