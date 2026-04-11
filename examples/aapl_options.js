/**
 * Example: Fetch AAPL options chain
 * node examples/aapl_options.js
 *
 * Note: This uses TradingView's options REST API — TradingView Desktop
 *       does NOT need to be open for this command.
 */
const { TradingViewAnalyzer } = require('../market_analyzer');

(async () => {
  const analyzer = new TradingViewAnalyzer();

  console.log('Fetching AAPL options chain...\n');
  const data = await analyzer.getOptionsChain('AAPL');

  if (data.error) {
    console.error('Error:', data.error);
    return;
  }

  console.log(`Symbol  : ${data.symbol}`);
  console.log(`Expiries: ${data.expiries.join(', ')}\n`);

  // Print the first two expiries
  for (const exp of data.expiries.slice(0, 2)) {
    console.log(`\n── Expiry: ${exp} ──`);
    console.log('Strike   CallBid  CallAsk  CallIV   PutBid   PutAsk   PutIV');
    for (const row of data.chain[exp]) {
      const iv = pct => pct != null ? `${(pct * 100).toFixed(1)}%`.padEnd(9) : '  --    ';
      console.log(
        `${String(row.strike).padEnd(9)}` +
        `${fmt(row.callBid)}  ${fmt(row.callAsk)}  ${iv(row.callIV)}` +
        `${fmt(row.putBid)}  ${fmt(row.putAsk)}  ${iv(row.putIV)}`
      );
    }
  }
})();

function fmt (n) { return n != null ? n.toFixed(2).padEnd(9) : '--       '; }
