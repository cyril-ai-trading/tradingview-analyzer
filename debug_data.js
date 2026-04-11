/**
 * Debug: read data WITHOUT changing symbol
 * node debug_data.js
 */
const { TradingViewCDP } = require('./market_analyzer');
const cdp = new TradingViewCDP('localhost', 9222);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TV  = `(function(){const n=['TradingViewApi','tvWidget'];for(const k of n){if(window[k]&&typeof window[k].activeChart==='function')return window[k];}return null;})()`;
const SER = `${TV}.activeChart().getSeries()`;

(async () => {
  await cdp.connect();
  console.log('Connected\n');

  // 1. Current chart state WITHOUT setSymbol
  const state = await cdp.eval(`
    (function() {
      var s = ${SER};
      return {
        symbol:    ${TV}.activeChart().symbol(),
        isFailed:  s.isFailed(),
        isLoading: s.isLoading(),
        barsCount: s.barsCount(),
        dataSize:  s.data().size(),
      };
    })()
  `);
  console.log('Current state (no setSymbol):', state);

  // If still failed, try resetData and wait
  if (state.isFailed || state.barsCount === 0) {
    console.log('\nSeries failed/empty — trying resetData()...');
    await cdp.eval(`${TV}.activeChart().resetData();`);
    await sleep(4000);

    const state2 = await cdp.eval(`
      (function() {
        var s = ${SER};
        return { isFailed: s.isFailed(), isLoading: s.isLoading(), barsCount: s.barsCount(), dataSize: s.data().size() };
      })()
    `);
    console.log('After resetData:', state2);
  }

  // 2. Try data().bars() method
  const barsResult = await cdp.eval(`
    (function() {
      try {
        var bars = ${SER}.data().bars();
        return { type: typeof bars, isArray: Array.isArray(bars), length: bars ? (bars.length || bars.size || 'n/a') : 'null' };
      } catch(e) { return 'error: ' + e.message; }
    })()
  `);
  console.log('\ndata().bars():', barsResult);

  // 3. Try data().last() and data().first()
  const firstLast = await cdp.eval(`
    (function() {
      var d = ${SER}.data();
      var out = {};
      try { var f = d.first(); out.first = f ? JSON.stringify(f) : 'null'; } catch(e) { out.firstErr = e.message; }
      try { var l = d.last();  out.last  = l ? JSON.stringify(l) : 'null'; } catch(e) { out.lastErr  = e.message; }
      try { var v = d.valueAt(d.size()-1); out.valueAt = v ? JSON.stringify(v) : 'null'; } catch(e) { out.valueAtErr = e.message; }
      return out;
    })()
  `);
  console.log('\nfirst/last/valueAt:', JSON.stringify(firstLast, null, 2));

  // 4. Try internal m_bars property
  const mBars = await cdp.eval(`
    (function() {
      try {
        var d = ${SER}.data();
        var mb = d.m_bars;
        return { type: typeof mb, keys: mb ? Object.keys(mb).slice(0,10).join(',') : 'null' };
      } catch(e) { return 'error: ' + e.message; }
    })()
  `);
  console.log('\nm_bars:', mBars);

  // 5. Try lastProjectionPrice
  const lastPrice = await cdp.eval(`
    (function() {
      try {
        var d = ${SER}.data();
        return { lastProjectionPrice: d.lastProjectionPrice };
      } catch(e) { return 'error: ' + e.message; }
    })()
  `);
  console.log('\nlastProjectionPrice:', lastPrice);

  // 6. Use onDataLoaded event to wait for real data, then read bars
  console.log('\nListening for onDataLoaded event (max 10s)...');
  await cdp.eval('window.__onDataFired = false;');
  await cdp.eval(`
    (function() {
      var chart = ${TV}.activeChart();
      chart.onDataLoaded().subscribe(null, function() {
        window.__onDataFired = true;
      }, true);
    })();
  `);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const fired = await cdp.eval('window.__onDataFired');
    if (fired) { console.log('onDataLoaded fired!'); break; }
    if (i === 19) console.log('onDataLoaded never fired');
  }

  const afterEvent = await cdp.eval(`
    (function() {
      var s = ${SER};
      return { barsCount: s.barsCount(), dataSize: s.data().size(), isFailed: s.isFailed() };
    })()
  `);
  console.log('State after onDataLoaded:', afterEvent);

  cdp.disconnect();
})().catch(console.error);
