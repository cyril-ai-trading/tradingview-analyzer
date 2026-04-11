/**
 * Example: Fetch CAC 40 market data
 * node examples/cac40.js
 */
const { TradingViewAnalyzer } = require('../market_analyzer');

(async () => {
  const analyzer = new TradingViewAnalyzer();
  await analyzer.connect();

  // Real-time quote
  const quote = await analyzer.getQuote('EURONEXT:CAC40');
  console.log('CAC 40 Quote:', quote);

  // Daily candles for the last 30 sessions
  const candles = await analyzer.getOHLCV('EURONEXT:CAC40', '1D', 30);
  console.log(`\nLast ${candles.length} daily candles:`);
  for (const c of candles.slice(-5)) {
    console.log(`  ${c.date}  O:${c.open}  H:${c.high}  L:${c.low}  C:${c.close}`);
  }

  // Weekly candles
  const weekly = await analyzer.getOHLCV('EURONEXT:CAC40', '1W', 12);
  console.log(`\nLast ${weekly.length} weekly candles:`);
  for (const c of weekly.slice(-3)) {
    console.log(`  ${c.date}  Close: ${c.close}`);
  }

  analyzer.disconnect();
})();
