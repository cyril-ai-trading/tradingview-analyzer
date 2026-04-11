/**
 * Raw WebSocket debug — log ALL messages from TradingView
 * node debug_ws.js
 */
const WebSocket = require('ws');

function encode(obj) {
  const s = JSON.stringify(obj);
  return `~m~${s.length}~m~${s}`;
}

function decode(raw) {
  const results = [];
  let rest = raw;
  while (rest.length) {
    const match = rest.match(/^~m~(\d+)~m~/);
    if (!match) break;
    const len   = parseInt(match[1], 10);
    const start = match[0].length;
    const body  = rest.slice(start, start + len);
    rest        = rest.slice(start + len);
    if (body.startsWith('~h~')) {
      results.push({ type: 'heartbeat', n: body.slice(3) });
    } else {
      try { results.push({ type: 'msg', data: JSON.parse(body) }); }
      catch (_) { results.push({ type: 'raw', data: body.slice(0, 200) }); }
    }
  }
  return results;
}

const uid = () => Math.random().toString(36).slice(2, 12);

const ws = new WebSocket(
  'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2024_12_14-09_50&type=chart',
  {
    headers: {
      Origin:       'https://www.tradingview.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    },
  }
);

let msgCount = 0;
const csId  = 'cs_' + uid();
const qsId  = 'qs_' + uid();

ws.on('open', () => {
  console.log('Connected!\n');

  // Send protocol messages one by one
  const sends = [
    { m: 'set_auth_token',      p: ['unauthorized_user_token'] },
    { m: 'set_locale',          p: ['en', 'US'] },
    { m: 'quote_create_session',p: [qsId] },
    { m: 'chart_create_session',p: [csId, ''] },
    { m: 'resolve_symbol', p: [csId, 'sds_sym_1', '={"symbol":"TVC:CAC40","adjustment":"splits"}'] },
    { m: 'create_series',  p: [csId, 'sds_1', 's1', 'sds_sym_1', 'D', 5] },
  ];

  for (const msg of sends) {
    console.log('→ SEND:', msg.m, JSON.stringify(msg.p).slice(0, 80));
    ws.send(encode(msg));
  }
});

ws.on('message', (raw) => {
  const frames = decode(raw.toString());
  for (const frame of frames) {
    msgCount++;

    if (frame.type === 'heartbeat') {
      console.log(`← HB ~h~${frame.n}`);
      ws.send(`~m~${('~h~' + frame.n).length}~m~~h~${frame.n}`);
      continue;
    }

    const m = frame.data?.m ?? '?';
    const p = frame.data?.p;

    // Print a summary of each message
    if (m === 'timescale_update') {
      console.log(`← TIMESCALE_UPDATE → keys: ${p ? Object.keys(p[1] ?? {}).join(',') : '?'}`);
      // Print the actual bar data
      const sds = p?.[1]?.sds_1;
      if (sds?.s?.length) {
        console.log(`   bars: ${sds.s.length}, last: ${JSON.stringify(sds.s.slice(-2))}`);
      }
    } else if (m === 'symbol_resolved') {
      const info = p?.[2];
      console.log(`← SYMBOL_RESOLVED: ${info?.name ?? '?'} (${info?.exchange ?? '?'})`);
    } else if (m === 'series_loading') {
      console.log(`← SERIES_LOADING`);
    } else if (m === 'series_completed') {
      console.log(`← SERIES_COMPLETED`);
    } else if (m === 'du') {
      // data update — might contain OHLCV
      console.log(`← DU: ${JSON.stringify(p).slice(0, 150)}`);
    } else if (m === 'critical_error' || m === 'protocol_error') {
      console.log(`← ERROR: ${JSON.stringify(frame.data)}`);
    } else {
      console.log(`← MSG[${msgCount}] m=${m} p=${JSON.stringify(p ?? null).slice(0, 120)}`);
    }
  }
});

ws.on('error', e => console.error('WS error:', e.message));
ws.on('close', (code, reason) => console.log(`Closed: ${code} ${reason}`));

// Stop after 15s
setTimeout(() => { console.log('\n--- timeout, closing ---'); ws.close(); }, 15000);
