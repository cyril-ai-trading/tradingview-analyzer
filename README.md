# TradingView Analyzer

Outil d'analyse de marché complet utilisant les données TradingView + CBOE + Market Chameleon.

## Fonctionnalités

- **Screener** — 50+ filtres (RSI, EMA, ADX, PE, beta, secteur...), 8 presets
- **OHLCV + Indicateurs** — SMA/EMA/RSI/MACD/Bollinger/ATR/ADX/Ichimoku/Pivots...
- **Chaîne d'options** — Via CBOE, Greeks complets (Delta/Gamma/Vega/Theta/Rho)
- **Analyse earnings** — Straddle, Iron Condor, Implied Move automatiques
- **Calendriers** — Earnings, dividendes, macro
- **IV Rank/Percentile** — Via Market Chameleon (Chrome MCP)

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage rapide

```bash
# Quote
node analyze.js quote --symbol AAPL

# OHLCV + tous les indicateurs
node analyze.js indicators --symbol AAPL --timeframe 1D --bars 200

# Screener
node analyze.js screen --market america --preset oversold
node analyze.js screen --market america --rsi-min 40 --rsi-max 60 --cap-min 10

# Chaîne d'options
node analyze.js chain --symbol AAPL --expiry 2026-05-16 --strikes 10
node analyze.js chain --symbol BMY --expiry 2026-05-01 --earnings

# Calendrier earnings
node analyze.js calendar --type earnings --from 2026-04-20 --to 2026-05-10

# Aide complète
node analyze.js help
```

## Presets screener

| Preset | Description |
|--------|-------------|
| `oversold` | RSI < 35, volume > 500K |
| `overbought` | RSI > 70, volume > 500K |
| `bullishBreakout` | RSI 50-70, prix > EMA200, volume relatif > 1.5x |
| `goldenCross` | EMA50 > SMA200, RSI 45-75 |
| `earningsPlay` | Cap > 5B, prix 20-500$, volume > 1M |
| `strongMomentum` | RSI > 60, ADX > 25, prix > EMA20 |
| `value` | PE 5-18, PB < 2, dividende > 1% |
| `highVolatility` | Bollinger Width large, ATR élevé |

## Architecture

```
analyze.js          CLI principal
market_analyzer.js  Connexion TradingView WebSocket
tv_feed.js          Feed données temps réel
tv_screener.js      Scanner API TradingView
tv_calendar.js      Calendriers earnings/dividendes/macro
tv_indicators.js    Indicateurs techniques (calcul local)
options_chain.js    Chaîne d'options CBOE + Greeks
iv_scraper.js       Scraper Market Chameleon (Playwright)
fetch_earnings.js   Candidats earnings pour options plays
```

## Sources de données

- **TradingView** — Prix, OHLCV, screener, calendriers (WebSocket + REST)
- **CBOE** — Chaîne d'options avec Greeks (public, pas d'auth)
- **Market Chameleon** — IV Rank, IV Percentile (via Chrome)
