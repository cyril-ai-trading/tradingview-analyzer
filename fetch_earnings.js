const { getEarningsCalendar } = require('./tv_calendar');
const { TVFeed } = require('./tv_feed');

async function run() {
  // Fenêtre 15-25 jours à partir du 10 avril 2026
  const from = new Date('2026-04-25');
  const to   = new Date('2026-05-05');

  process.stderr.write('Fetching earnings 25 Apr → 5 May...\n');
  const data = await getEarningsCalendar({ from, to, markets: ['america'], limit: 300 });

  // Dédupliquer par company name
  const seen = new Set();
  const unique = data.filter(e => {
    if (!e.company || seen.has(e.company)) return false;
    seen.add(e.company); return true;
  });

  // Filtre cap > 5B
  const bigCap = unique.filter(e => e.marketCap && e.marketCap > 5e9);
  bigCap.sort((a,b) => b.marketCap - a.marketCap);

  process.stderr.write(`Total: ${data.length} | Unique: ${unique.length} | Cap>5B: ${bigCap.length}\n`);

  // Maintenant récupérer les prix via TV feed pour filtrer $20-$500
  const feed = new TVFeed();
  await feed.connect();

  const results = [];
  for (const e of bigCap.slice(0, 50)) {
    try {
      const sym = e.symbol.includes(':') ? e.symbol : 'NASDAQ:' + e.symbol;
      const bars = await feed.getOHLCV(sym, 'D', 2);
      const price = bars[bars.length-1]?.close ?? 0;
      e.price = price;
      if (price >= 20 && price <= 500) {
        results.push(e);
      }
    } catch(err) {
      // skip
    }
  }
  feed.disconnect();

  // Afficher résultats
  console.log('\n=== EARNINGS 25 Apr - 5 May | Cap>5B | Prix $20-500 ===\n');
  console.log('Date        | Heure | Symbole              | Société                          | Prix    | EPS Est | Cap');
  console.log('─'.repeat(110));
  for (const e of results) {
    const date  = (e.date||'--').padEnd(12);
    const time  = String(e.time||'--').padEnd(7);
    const sym   = e.symbol.padEnd(22);
    const co    = (e.company||'').slice(0,32).padEnd(34);
    const px    = e.price ? `$${e.price.toFixed(2)}`.padStart(8) : '      --';
    const eps   = e.epsEstimate != null ? e.epsEstimate.toFixed(2).padStart(8) : '      --';
    const cap   = e.marketCap ? `${(e.marketCap/1e9).toFixed(1)}B`.padStart(8) : '      --';
    console.log(`${date}| ${time}| ${sym}| ${co}| ${px} | ${eps} | ${cap}`);
  }
  console.log(`\n${results.length} candidats trouvés.`);
}

run().catch(console.error);
