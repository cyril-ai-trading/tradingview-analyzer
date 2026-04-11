/**
 * Example: Multi-asset scan with bias detection
 * node examples/multi_scan.js
 *
 * Scans CAC40, AAPL, BTC and SPX across Daily + 4h timeframes.
 * Prints a structured bias report.
 */
const { TradingViewAnalyzer } = require('../market_analyzer');

const WATCHLIST = [
  'EURONEXT:CAC40',
  'NASDAQ:AAPL',
  'BINANCE:BTCUSDT',
  'SP:SPX',
];

const TIMEFRAMES = ['1D', '4h'];

(async () => {
  const analyzer = new TradingViewAnalyzer();
  await analyzer.connect();

  console.log('Running multi-asset scan...\n');
  const report = await analyzer.scan(WATCHLIST, TIMEFRAMES);

  // ── Summary ───────────────────────────────────────────────────────────────
  const bullish = [], bearish = [], neutral = [], unknown = [];

  for (const [sym, tfs] of Object.entries(report)) {
    const dailyBias = tfs['1D']?.bias ?? 'unknown';
    console.log(`${sym.padEnd(24)} Daily bias: ${dailyBias.toUpperCase()}`);

    if      (dailyBias === 'bullish') bullish.push(sym);
    else if (dailyBias === 'bearish') bearish.push(sym);
    else if (dailyBias === 'neutral') neutral.push(sym);
    else                              unknown.push(sym);
  }

  console.log('\n─────── Summary ───────────────────────────────');
  console.log(`Bullish (${bullish.length}): ${bullish.join(', ') || 'none'}`);
  console.log(`Bearish (${bearish.length}): ${bearish.join(', ') || 'none'}`);
  console.log(`Neutral (${neutral.length}): ${neutral.join(', ') || 'none'}`);
  console.log('───────────────────────────────────────────────\n');

  analyzer.disconnect();
})();
