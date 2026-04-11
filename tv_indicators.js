/**
 * tv_indicators.js
 * Module de calcul d'indicateurs techniques en JavaScript pur (sans dépendances npm)
 * Format d'entrée : [{date, open, high, low, close, volume}, ...]
 */

'use strict';

// ─────────────────────────────────────────────
// UTILITAIRES INTERNES
// ─────────────────────────────────────────────

/** Extrait les closes */
const closes = bars => bars.map(b => b.close);
/** Extrait les highs */
const highs = bars => bars.map(b => b.high);
/** Extrait les lows */
const lows = bars => bars.map(b => b.low);
/** Moyenne d'un tableau de nombres */
const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
/** Écart-type (population) */
const stddev = arr => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};
/** Clamp d'une valeur */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
/** Arrondi à N décimales */
const round = (v, n = 4) => (v === null || v === undefined || isNaN(v)) ? null : +v.toFixed(n);

// ─────────────────────────────────────────────
// MOYENNES MOBILES
// ─────────────────────────────────────────────

/**
 * Simple Moving Average
 * SMA(n) = moyenne des n derniers closes
 * @param {Array} bars
 * @param {number} period
 * @returns {Array<number|null>}
 */
function sma(bars, period) {
  const c = closes(bars);
  return c.map((_, i) => {
    if (i < period - 1) return null;
    return round(mean(c.slice(i - period + 1, i + 1)));
  });
}

/**
 * Exponential Moving Average
 * EMA(t) = close * k + EMA(t-1) * (1-k)  avec k = 2 / (period + 1)
 * @param {Array} bars
 * @param {number} period
 * @returns {Array<number|null>}
 */
function ema(bars, period) {
  const c = closes(bars);
  const k = 2 / (period + 1);
  const result = new Array(c.length).fill(null);
  // Premier EMA = SMA des `period` premières valeurs
  if (c.length < period) return result;
  result[period - 1] = mean(c.slice(0, period));
  for (let i = period; i < c.length; i++) {
    result[i] = c[i] * k + result[i - 1] * (1 - k);
  }
  return result.map(v => round(v));
}

/**
 * Weighted Moving Average (pondération linéaire)
 * WMA(n) = somme(close[i] * i) / somme(i)  pour i = 1..n
 * @param {Array} bars
 * @param {number} period
 * @returns {Array<number|null>}
 */
function wma(bars, period) {
  const c = closes(bars);
  const denom = (period * (period + 1)) / 2; // 1+2+...+n
  return c.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += c[i - period + 1 + j] * (j + 1);
    }
    return round(sum / denom);
  });
}

// ─────────────────────────────────────────────
// INDICATEURS DE TENDANCE
// ─────────────────────────────────────────────

/**
 * MACD — Moving Average Convergence Divergence
 * MACD line     = EMA(fast) - EMA(slow)
 * Signal line   = EMA(MACD line, signal)
 * Histogram     = MACD line - Signal line
 * @param {Array} bars
 * @param {number} fast   default 12
 * @param {number} slow   default 26
 * @param {number} signal default 9
 * @returns {Array<{macd, signal, histogram}|null>}
 */
function macd(bars, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(bars, fast);
  const emaSlow = ema(bars, slow);
  const n = bars.length;

  // Ligne MACD brute (null si l'une des EMA est null)
  const macdLine = emaFast.map((f, i) =>
    f === null || emaSlow[i] === null ? null : f - emaSlow[i]
  );

  // EMA de la ligne MACD (signal)
  // On doit construire un tableau de "bars-like" pour réutiliser ema()
  // On crée des faux bars avec close = valeur MACD
  const firstValid = macdLine.findIndex(v => v !== null);
  const signalLine = new Array(n).fill(null);
  if (firstValid === -1) return bars.map(() => null);

  // Construire un sous-tableau à partir du premier MACD valide
  const macdBars = macdLine.slice(firstValid).map(v => ({ close: v }));
  const sigEma = ema(macdBars, signal);
  // Replacer dans le tableau de taille n
  for (let i = 0; i < sigEma.length; i++) {
    signalLine[firstValid + i] = sigEma[i];
  }

  return macdLine.map((m, i) => {
    if (m === null || signalLine[i] === null) return null;
    return {
      macd: round(m),
      signal: round(signalLine[i]),
      histogram: round(m - signalLine[i])
    };
  });
}

/**
 * ADX — Average Directional Index
 * +DM = max(high - prevHigh, 0) si > max(prevLow - low, 0) sinon 0
 * -DM = max(prevLow - low, 0)  si > max(high - prevHigh, 0) sinon 0
 * TR  = max(high-low, |high-prevClose|, |low-prevClose|)
 * +DI = 100 * EMA(+DM, period) / EMA(TR, period)
 * -DI = 100 * EMA(-DM, period) / EMA(TR, period)
 * DX  = 100 * |+DI - -DI| / (+DI + -DI)
 * ADX = EMA(DX, period)
 * @param {Array} bars
 * @param {number} period default 14
 * @returns {Array<{adx, plusDI, minusDI}|null>}
 */
function adx(bars, period = 14) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;

  const trArr = [], plusDMArr = [], minusDMArr = [];

  for (let i = 1; i < n; i++) {
    const { high, low, close: c } = bars[i];
    const { high: ph, low: pl, close: pc } = bars[i - 1];

    const tr = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
    const upMove = high - ph;
    const downMove = pl - low;

    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

    trArr.push(tr);
    plusDMArr.push(plusDM);
    minusDMArr.push(minusDM);
  }

  // Smoothed sums initiaux (Wilder's smoothing = RMA)
  // Premier segment : somme simple
  let smoothTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDMArr.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr = [];

  const calcDIDX = (tr, plus, minus) => {
    const plusDI = tr !== 0 ? 100 * plus / tr : 0;
    const minusDI = tr !== 0 ? 100 * minus / tr : 0;
    const sum = plusDI + minusDI;
    const dx = sum !== 0 ? 100 * Math.abs(plusDI - minusDI) / sum : 0;
    return { plusDI, minusDI, dx };
  };

  const { plusDI: pi0, minusDI: mi0, dx: dx0 } = calcDIDX(smoothTR, smoothPlus, smoothMinus);
  dxArr.push({ plusDI: pi0, minusDI: mi0, dx: dx0 });

  for (let i = period; i < trArr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trArr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDMArr[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDMArr[i];
    const { plusDI, minusDI, dx } = calcDIDX(smoothTR, smoothPlus, smoothMinus);
    dxArr.push({ plusDI, minusDI, dx });
  }

  // ADX = moyenne mobile de DX (Wilder's smoothing)
  if (dxArr.length < period) return result;
  let adxVal = dxArr.slice(0, period).reduce((s, d) => s + d.dx, 0) / period;
  // index de bars correspondant : i=period correspond à bars[period+1-1]=bars[period]
  // dxArr[0] → bars[period], dxArr[k] → bars[period+k]
  result[2 * period - 1] = {
    adx: round(adxVal),
    plusDI: round(dxArr[period - 1].plusDI),
    minusDI: round(dxArr[period - 1].minusDI)
  };

  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i].dx) / period;
    result[period + i] = {
      adx: round(adxVal),
      plusDI: round(dxArr[i].plusDI),
      minusDI: round(dxArr[i].minusDI)
    };
  }

  return result;
}

/**
 * Ichimoku Kinko Hyo
 * Tenkan-sen  (conversion)  = (max9high + min9low) / 2
 * Kijun-sen   (base)        = (max26high + min26low) / 2
 * Senkou A    (leading A)   = (Tenkan + Kijun) / 2  décalé +26
 * Senkou B    (leading B)   = (max52high + min52low) / 2  décalé +26
 * Chikou      (lagging)     = close décalé -26
 * @param {Array} bars
 * @returns {Array<{tenkan, kijun, senkouA, senkouB, chikou}|null>}
 */
function ichimoku(bars) {
  const n = bars.length;
  const result = new Array(n).fill(null).map(() => ({
    tenkan: null, kijun: null, senkouA: null, senkouB: null, chikou: null
  }));

  const midpoint = (period, i) => {
    if (i < period - 1) return null;
    const slice = bars.slice(i - period + 1, i + 1);
    const h = Math.max(...slice.map(b => b.high));
    const l = Math.min(...slice.map(b => b.low));
    return (h + l) / 2;
  };

  for (let i = 0; i < n; i++) {
    const tenkan = midpoint(9, i);
    const kijun = midpoint(26, i);
    const senkouB = midpoint(52, i);

    result[i].tenkan = round(tenkan);
    result[i].kijun = round(kijun);

    // Senkou A et B sont décalés de +26 dans le futur (on les place 26 bougies en avant)
    if (tenkan !== null && kijun !== null && i + 26 < n) {
      result[i + 26].senkouA = round((tenkan + kijun) / 2);
    }
    if (senkouB !== null && i + 26 < n) {
      result[i + 26].senkouB = round(senkouB);
    }

    // Chikou = close décalé -26 (on le place 26 bougies en arrière)
    if (i >= 26) {
      result[i - 26].chikou = round(bars[i].close);
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// MOMENTUM / OSCILLATEURS
// ─────────────────────────────────────────────

/**
 * RSI — Relative Strength Index (méthode Wilder's Smoothing)
 * RS  = Avg Gain / Avg Loss
 * RSI = 100 - 100 / (1 + RS)
 * @param {Array} bars
 * @param {number} period default 14
 * @returns {Array<number|null>}
 */
function rsi(bars, period = 14) {
  const c = closes(bars);
  const n = c.length;
  const result = new Array(n).fill(null);
  if (n <= period) return result;

  // Calcul des variations
  const changes = c.slice(1).map((v, i) => v - c[i]);
  const gains = changes.map(d => d > 0 ? d : 0);
  const losses = changes.map(d => d < 0 ? -d : 0);

  // Première moyenne (SMA sur `period` éléments)
  let avgGain = mean(gains.slice(0, period));
  let avgLoss = mean(losses.slice(0, period));

  const calcRSI = (g, l) => l === 0 ? 100 : round(100 - 100 / (1 + g / l));
  result[period] = calcRSI(avgGain, avgLoss);

  // Wilder's smoothing pour les suivants
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result[i + 1] = calcRSI(avgGain, avgLoss);
  }

  return result;
}

/**
 * Stochastic Oscillator
 * %K = 100 * (close - lowestLow) / (highestHigh - lowestLow)  sur kPeriod
 * %K lissé = SMA(%K, smooth)
 * %D = SMA(%K lissé, dPeriod)
 * @param {Array} bars
 * @param {number} kPeriod default 14
 * @param {number} dPeriod default 3
 * @param {number} smooth  default 3  (lissage du %K brut)
 * @returns {Array<{k, d}|null>}
 */
function stochastic(bars, kPeriod = 14, dPeriod = 3, smooth = 3) {
  const n = bars.length;

  // %K brut
  const rawK = bars.map((b, i) => {
    if (i < kPeriod - 1) return null;
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const hl = Math.max(...slice.map(x => x.high));
    const ll = Math.min(...slice.map(x => x.low));
    return hl === ll ? 0 : 100 * (b.close - ll) / (hl - ll);
  });

  // %K lissé (smooth periods)
  const smoothedK = rawK.map((_, i) => {
    if (i < kPeriod - 1 + smooth - 1) return null;
    const slice = rawK.slice(i - smooth + 1, i + 1);
    if (slice.some(v => v === null)) return null;
    return mean(slice);
  });

  // %D = SMA(smoothedK, dPeriod)
  const result = smoothedK.map((_, i) => {
    if (i < kPeriod - 1 + smooth - 1 + dPeriod - 1) return null;
    const slice = smoothedK.slice(i - dPeriod + 1, i + 1);
    if (slice.some(v => v === null)) return null;
    return {
      k: round(smoothedK[i]),
      d: round(mean(slice))
    };
  });

  return result;
}

/**
 * CCI — Commodity Channel Index
 * Typical Price (TP) = (high + low + close) / 3
 * CCI = (TP - SMA(TP, period)) / (0.015 * MeanDeviation)
 * @param {Array} bars
 * @param {number} period default 20
 * @returns {Array<number|null>}
 */
function cci(bars, period = 20) {
  const n = bars.length;
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);

  return tp.map((t, i) => {
    if (i < period - 1) return null;
    const slice = tp.slice(i - period + 1, i + 1);
    const smaTP = mean(slice);
    const meanDev = mean(slice.map(v => Math.abs(v - smaTP)));
    if (meanDev === 0) return null;
    return round((t - smaTP) / (0.015 * meanDev));
  });
}

/**
 * Williams %R
 * %R = -100 * (highestHigh - close) / (highestHigh - lowestLow)
 * Valeurs entre -100 (survendu) et 0 (suracheté)
 * @param {Array} bars
 * @param {number} period default 14
 * @returns {Array<number|null>}
 */
function williams(bars, period = 14) {
  return bars.map((b, i) => {
    if (i < period - 1) return null;
    const slice = bars.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map(x => x.high));
    const ll = Math.min(...slice.map(x => x.low));
    if (hh === ll) return null;
    return round(-100 * (hh - b.close) / (hh - ll));
  });
}

/**
 * ROC — Rate of Change
 * ROC = 100 * (close - close[n]) / close[n]
 * @param {Array} bars
 * @param {number} period default 12
 * @returns {Array<number|null>}
 */
function roc(bars, period = 12) {
  const c = closes(bars);
  return c.map((v, i) => {
    if (i < period) return null;
    const prev = c[i - period];
    if (prev === 0) return null;
    return round(100 * (v - prev) / prev);
  });
}

/**
 * Momentum
 * Momentum = close - close[period]
 * @param {Array} bars
 * @param {number} period default 10
 * @returns {Array<number|null>}
 */
function momentum(bars, period = 10) {
  const c = closes(bars);
  return c.map((v, i) => {
    if (i < period) return null;
    return round(v - c[i - period]);
  });
}

/**
 * MFI — Money Flow Index
 * Typical Price (TP) = (high + low + close) / 3
 * Raw Money Flow = TP * volume
 * Money Ratio = Positive MF / Negative MF  (sur `period` bougies)
 * MFI = 100 - 100 / (1 + Money Ratio)
 * @param {Array} bars
 * @param {number} period default 14
 * @returns {Array<number|null>}
 */
function mfi(bars, period = 14) {
  const n = bars.length;
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);
  const mf = tp.map((t, i) => t * bars[i].volume);

  return bars.map((_, i) => {
    if (i < period) return null;
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) posFlow += mf[j];
      else negFlow += mf[j];
    }
    if (negFlow === 0) return 100;
    const mr = posFlow / negFlow;
    return round(100 - 100 / (1 + mr));
  });
}

// ─────────────────────────────────────────────
// VOLATILITÉ
// ─────────────────────────────────────────────

/**
 * Bollinger Bands
 * Middle  = SMA(close, period)
 * Upper   = Middle + stdDev * σ
 * Lower   = Middle - stdDev * σ
 * Bandwidth = (Upper - Lower) / Middle * 100
 * %B      = (close - Lower) / (Upper - Lower)
 * @param {Array} bars
 * @param {number} period default 20
 * @param {number} stdDev default 2
 * @returns {Array<{upper, middle, lower, bandwidth, percentB}|null>}
 */
function bollingerBands(bars, period = 20, mult = 2) {
  const c = closes(bars);
  return c.map((v, i) => {
    if (i < period - 1) return null;
    const slice = c.slice(i - period + 1, i + 1);
    const middle = mean(slice);
    const sd = stddev(slice);
    const upper = middle + mult * sd;
    const lower = middle - mult * sd;
    const bandwidth = middle !== 0 ? (upper - lower) / middle * 100 : null;
    const percentB = upper !== lower ? (v - lower) / (upper - lower) : null;
    return {
      upper: round(upper),
      middle: round(middle),
      lower: round(lower),
      bandwidth: round(bandwidth),
      percentB: round(percentB)
    };
  });
}

/**
 * ATR — Average True Range (Wilder's smoothing)
 * TR  = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = Wilder's moving average de TR sur `period` périodes
 * @param {Array} bars
 * @param {number} period default 14
 * @returns {Array<number|null>}
 */
function atr(bars, period = 14) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n <= period) return result;

  const trArr = [null]; // index 0 : pas de TR (pas de bougie précédente)
  for (let i = 1; i < n; i++) {
    const { high, low } = bars[i];
    const pc = bars[i - 1].close;
    trArr.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }

  // Première valeur ATR = SMA des `period` premières TR (indices 1..period)
  let atrVal = mean(trArr.slice(1, period + 1));
  result[period] = round(atrVal);

  for (let i = period + 1; i < n; i++) {
    atrVal = (atrVal * (period - 1) + trArr[i]) / period;
    result[i] = round(atrVal);
  }

  return result;
}

/**
 * Keltner Channels
 * Middle = EMA(close, period)
 * ATR    = ATR(bars, period)
 * Upper  = Middle + atrMultiplier * ATR
 * Lower  = Middle - atrMultiplier * ATR
 * @param {Array} bars
 * @param {number} period         default 20
 * @param {number} atrMultiplier  default 2
 * @returns {Array<{upper, middle, lower}|null>}
 */
function keltnerChannels(bars, period = 20, atrMultiplier = 2) {
  const emaVals = ema(bars, period);
  const atrVals = atr(bars, period);

  return bars.map((_, i) => {
    if (emaVals[i] === null || atrVals[i] === null) return null;
    const mid = emaVals[i];
    const a = atrVals[i];
    return {
      upper: round(mid + atrMultiplier * a),
      middle: round(mid),
      lower: round(mid - atrMultiplier * a)
    };
  });
}

// ─────────────────────────────────────────────
// VOLUME
// ─────────────────────────────────────────────

/**
 * VWAP — Volume Weighted Average Price (cumulatif sur l'ensemble du tableau fourni)
 * VWAP = Σ(TP * volume) / Σ(volume)
 * @param {Array} bars
 * @returns {Array<number|null>}
 */
function vwap(bars) {
  let cumTPV = 0, cumVol = 0;
  return bars.map(b => {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
    if (cumVol === 0) return null;
    return round(cumTPV / cumVol);
  });
}

/**
 * OBV — On Balance Volume
 * Si close > prevClose : OBV += volume
 * Si close < prevClose : OBV -= volume
 * Sinon                : OBV inchangé
 * @param {Array} bars
 * @returns {Array<number>}
 */
function obv(bars) {
  const result = [];
  let obvVal = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      result.push(bars[0].volume);
      obvVal = bars[0].volume;
      continue;
    }
    if (bars[i].close > bars[i - 1].close) obvVal += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) obvVal -= bars[i].volume;
    result.push(obvVal);
  }
  return result;
}

/**
 * CMF — Chaikin Money Flow
 * Money Flow Multiplier = ((close - low) - (high - close)) / (high - low)
 * Money Flow Volume     = MFM * volume
 * CMF = Σ(MFV sur period) / Σ(volume sur period)
 * @param {Array} bars
 * @param {number} period default 20
 * @returns {Array<number|null>}
 */
function cmf(bars, period = 20) {
  const mfv = bars.map(b => {
    const range = b.high - b.low;
    if (range === 0) return 0;
    const mfm = ((b.close - b.low) - (b.high - b.close)) / range;
    return mfm * b.volume;
  });

  return bars.map((b, i) => {
    if (i < period - 1) return null;
    const sumMFV = mfv.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0);
    const sumVol = bars.slice(i - period + 1, i + 1).reduce((s, x) => s + x.volume, 0);
    if (sumVol === 0) return null;
    return round(sumMFV / sumVol);
  });
}

// ─────────────────────────────────────────────
// NIVEAUX CLÉS
// ─────────────────────────────────────────────

/**
 * Pivot Points (méthode classique) basé sur la dernière bougie
 * Pivot = (high + low + close) / 3
 * R1 = 2*P - low    S1 = 2*P - high
 * R2 = P + (H-L)    S2 = P - (H-L)
 * R3 = H + 2*(P-L)  S3 = L - 2*(H-P)
 * @param {Array} bars
 * @returns {{pivot, r1, r2, r3, s1, s2, s3}}
 */
function pivotPoints(bars) {
  const last = bars[bars.length - 1];
  const { high: H, low: L, close: C } = last;
  const P = (H + L + C) / 3;
  return {
    pivot: round(P),
    r1: round(2 * P - L),
    r2: round(P + (H - L)),
    r3: round(H + 2 * (P - L)),
    s1: round(2 * P - H),
    s2: round(P - (H - L)),
    s3: round(L - 2 * (H - P))
  };
}

/**
 * 52-Week High/Low (parmi toutes les bougies fournies)
 * currentPct = position du close actuel entre le low et le high (0–100%)
 * @param {Array} bars
 * @returns {{high, low, currentPct}}
 */
function fiftyTwoWeek(bars) {
  const h = Math.max(...bars.map(b => b.high));
  const l = Math.min(...bars.map(b => b.low));
  const current = bars[bars.length - 1].close;
  const currentPct = h !== l ? round((current - l) / (h - l) * 100) : null;
  return { high: round(h), low: round(l), currentPct };
}

// ─────────────────────────────────────────────
// FONCTION PRINCIPALE
// ─────────────────────────────────────────────

/**
 * addIndicators — Enrichit chaque bougie avec les indicateurs sélectionnés
 *
 * @param {Array} bars    Tableau de bougies [{date, open, high, low, close, volume}]
 * @param {Object} options
 *   options.sma        {Array<number>} Périodes SMA ex: [20, 50, 200]
 *   options.ema        {Array<number>} Périodes EMA ex: [9, 20, 50, 200]
 *   options.wma        {Array<number>} Périodes WMA ex: [20]
 *   options.rsi        {number}        Période RSI (default 14)
 *   options.macd       {boolean|Object} true ou {fast,slow,signal}
 *   options.bb         {boolean|Object} true ou {period,stdDev}
 *   options.atr        {boolean|number} true ou période
 *   options.vwap       {boolean}
 *   options.obv        {boolean}
 *   options.stoch      {boolean|Object} true ou {kPeriod,dPeriod,smooth}
 *   options.adx        {boolean|number}
 *   options.cci        {boolean|number}
 *   options.williams   {boolean|number}
 *   options.roc        {boolean|number}
 *   options.momentum   {boolean|number}
 *   options.mfi        {boolean|number}
 *   options.keltner    {boolean|Object}
 *   options.ichimoku   {boolean}
 *   options.cmf        {boolean|number}
 *   options.pivots     {boolean}
 *   options.fiftyTwoWeek {boolean}
 *
 * @returns {Array} Copie de bars avec indicateurs ajoutés sur chaque bougie
 */
function addIndicators(bars, options = {}) {
  if (!bars || bars.length === 0) return [];

  // Defaults : tout activé si options vide
  const isDefault = Object.keys(options).length === 0;
  if (isDefault) {
    options = {
      sma:         [20, 50, 200],
      ema:         [9, 20, 50, 200],
      rsi:         14,
      macd:        true,
      bb:          true,
      atr:         true,
      vwap:        true,
      obv:         true,
      stoch:       true,
      adx:         true,
      cci:         true,
      williams:    true,
      roc:         true,
      momentum:    true,
      mfi:         true,
      pivots:      true,
      fiftyTwoWeek: true,
    };
  }

  // Copie profonde légère
  const result = bars.map(b => ({ ...b }));
  const n = bars.length;

  // ── SMA ──
  if (options.sma) {
    const periods = Array.isArray(options.sma) ? options.sma : [options.sma];
    for (const p of periods) {
      const vals = sma(bars, p);
      for (let i = 0; i < n; i++) result[i][`sma${p}`] = vals[i];
    }
  }

  // ── EMA ──
  if (options.ema) {
    const periods = Array.isArray(options.ema) ? options.ema : [options.ema];
    for (const p of periods) {
      const vals = ema(bars, p);
      for (let i = 0; i < n; i++) result[i][`ema${p}`] = vals[i];
    }
  }

  // ── WMA ──
  if (options.wma) {
    const periods = Array.isArray(options.wma) ? options.wma : [options.wma];
    for (const p of periods) {
      const vals = wma(bars, p);
      for (let i = 0; i < n; i++) result[i][`wma${p}`] = vals[i];
    }
  }

  // ── RSI ──
  if (options.rsi !== undefined) {
    const period = typeof options.rsi === 'number' ? options.rsi : 14;
    const vals = rsi(bars, period);
    for (let i = 0; i < n; i++) result[i].rsi = vals[i];
  }

  // ── MACD ──
  if (options.macd) {
    const cfg = typeof options.macd === 'object' ? options.macd : {};
    const vals = macd(bars, cfg.fast || 12, cfg.slow || 26, cfg.signal || 9);
    for (let i = 0; i < n; i++) {
      if (vals[i]) {
        result[i].macd = vals[i].macd;
        result[i].macdSignal = vals[i].signal;
        result[i].macdHist = vals[i].histogram;
      } else {
        result[i].macd = null;
        result[i].macdSignal = null;
        result[i].macdHist = null;
      }
    }
  }

  // ── Bollinger Bands ──
  if (options.bb) {
    const cfg = typeof options.bb === 'object' ? options.bb : {};
    const vals = bollingerBands(bars, cfg.period || 20, cfg.stdDev || 2);
    for (let i = 0; i < n; i++) {
      if (vals[i]) {
        result[i].bbUpper = vals[i].upper;
        result[i].bbMiddle = vals[i].middle;
        result[i].bbLower = vals[i].lower;
        result[i].bbBandwidth = vals[i].bandwidth;
        result[i].bbPercentB = vals[i].percentB;
      } else {
        result[i].bbUpper = null;
        result[i].bbMiddle = null;
        result[i].bbLower = null;
        result[i].bbBandwidth = null;
        result[i].bbPercentB = null;
      }
    }
  }

  // ── ATR ──
  if (options.atr !== undefined) {
    const period = typeof options.atr === 'number' ? options.atr : 14;
    const vals = atr(bars, period);
    for (let i = 0; i < n; i++) result[i].atr = vals[i];
  }

  // ── VWAP ──
  if (options.vwap) {
    const vals = vwap(bars);
    for (let i = 0; i < n; i++) result[i].vwap = vals[i];
  }

  // ── OBV ──
  if (options.obv) {
    const vals = obv(bars);
    for (let i = 0; i < n; i++) result[i].obv = vals[i];
  }

  // ── Stochastic ──
  if (options.stoch) {
    const cfg = typeof options.stoch === 'object' ? options.stoch : {};
    const vals = stochastic(bars, cfg.kPeriod || 14, cfg.dPeriod || 3, cfg.smooth || 3);
    for (let i = 0; i < n; i++) {
      if (vals[i]) {
        result[i].stochK = vals[i].k;
        result[i].stochD = vals[i].d;
      } else {
        result[i].stochK = null;
        result[i].stochD = null;
      }
    }
  }

  // ── ADX ──
  if (options.adx !== undefined) {
    const period = typeof options.adx === 'number' ? options.adx : 14;
    const vals = adx(bars, period);
    for (let i = 0; i < n; i++) {
      if (vals[i]) {
        result[i].adx = vals[i].adx;
        result[i].plusDI = vals[i].plusDI;
        result[i].minusDI = vals[i].minusDI;
      } else {
        result[i].adx = null;
        result[i].plusDI = null;
        result[i].minusDI = null;
      }
    }
  }

  // ── CCI ──
  if (options.cci !== undefined) {
    const period = typeof options.cci === 'number' ? options.cci : 20;
    const vals = cci(bars, period);
    for (let i = 0; i < n; i++) result[i].cci = vals[i];
  }

  // ── Williams %R ──
  if (options.williams !== undefined) {
    const period = typeof options.williams === 'number' ? options.williams : 14;
    const vals = williams(bars, period);
    for (let i = 0; i < n; i++) result[i].williamsR = vals[i];
  }

  // ── ROC ──
  if (options.roc !== undefined) {
    const period = typeof options.roc === 'number' ? options.roc : 12;
    const vals = roc(bars, period);
    for (let i = 0; i < n; i++) result[i].roc = vals[i];
  }

  // ── Momentum ──
  if (options.momentum !== undefined) {
    const period = typeof options.momentum === 'number' ? options.momentum : 10;
    const vals = momentum(bars, period);
    for (let i = 0; i < n; i++) result[i].momentum = vals[i];
  }

  // ── MFI ──
  if (options.mfi !== undefined) {
    const period = typeof options.mfi === 'number' ? options.mfi : 14;
    const vals = mfi(bars, period);
    for (let i = 0; i < n; i++) result[i].mfi = vals[i];
  }

  // ── Keltner Channels ──
  if (options.keltner) {
    const cfg = typeof options.keltner === 'object' ? options.keltner : {};
    const vals = keltnerChannels(bars, cfg.period || 20, cfg.atrMultiplier || 2);
    for (let i = 0; i < n; i++) {
      if (vals[i]) {
        result[i].keltnerUpper = vals[i].upper;
        result[i].keltnerMiddle = vals[i].middle;
        result[i].keltnerLower = vals[i].lower;
      } else {
        result[i].keltnerUpper = null;
        result[i].keltnerMiddle = null;
        result[i].keltnerLower = null;
      }
    }
  }

  // ── Ichimoku ──
  if (options.ichimoku) {
    const vals = ichimoku(bars);
    for (let i = 0; i < n; i++) {
      result[i].ichimokuTenkan = vals[i] ? vals[i].tenkan : null;
      result[i].ichimokuKijun = vals[i] ? vals[i].kijun : null;
      result[i].ichimokuSenkouA = vals[i] ? vals[i].senkouA : null;
      result[i].ichimokuSenkouB = vals[i] ? vals[i].senkouB : null;
      result[i].ichimokuChikou = vals[i] ? vals[i].chikou : null;
    }
  }

  // ── CMF ──
  if (options.cmf !== undefined) {
    const period = typeof options.cmf === 'number' ? options.cmf : 20;
    const vals = cmf(bars, period);
    for (let i = 0; i < n; i++) result[i].cmf = vals[i];
  }

  // ── Pivot Points (sur la dernière bougie uniquement) ──
  if (options.pivots) {
    const pp = pivotPoints(bars);
    // On attache les pivots à la dernière bougie
    Object.assign(result[n - 1], {
      pivotPP: pp.pivot,
      pivotR1: pp.r1, pivotR2: pp.r2, pivotR3: pp.r3,
      pivotS1: pp.s1, pivotS2: pp.s2, pivotS3: pp.s3
    });
  }

  // ── 52-Week High/Low ──
  if (options.fiftyTwoWeek) {
    const fw = fiftyTwoWeek(bars);
    // On attache à la dernière bougie
    Object.assign(result[n - 1], {
      week52High: fw.high,
      week52Low: fw.low,
      week52Pct: fw.currentPct
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// AFFICHAGE CLI
// ─────────────────────────────────────────────

/**
 * printIndicators — Affiche les N dernières bougies avec leurs indicateurs en tableau CLI
 * @param {Array} barsWithIndicators Sortie de addIndicators()
 * @param {number} last              Nombre de dernières bougies à afficher (default 5)
 */
function printIndicators(barsWithIndicators, last = 10) {
  if (!barsWithIndicators || barsWithIndicators.length === 0) {
    console.log('Aucune donnée à afficher.'); return;
  }

  const slice = barsWithIndicators.slice(-last);
  const latestBar = slice[slice.length - 1];
  const f = (v, dec = 2) => (v == null || isNaN(v)) ? '--' : Number(v).toFixed(dec);
  const fv = (v) => v == null ? '--' : Number(v) >= 1e6 ? `${(Number(v)/1e6).toFixed(1)}M` : Number(v).toFixed(0);

  // ── Section 1 : OHLCV tableau ────────────────────────────────────────────
  console.log('\n  ── OHLCV (dernières bougies) ──');
  console.log('  Date              Open       High        Low      Close       Volume');
  console.log('  ' + '─'.repeat(70));
  for (const b of slice) {
    const date = String(b.date ?? '').slice(0, 10).padEnd(16);
    console.log(`  ${date}  ${f(b.open).padStart(9)}  ${f(b.high).padStart(9)}  ${f(b.low).padStart(9)}  ${f(b.close).padStart(9)}  ${fv(b.volume).padStart(10)}`);
  }

  // ── Section 2 : Derniers indicateurs ────────────────────────────────────
  const bar = latestBar;
  const date = String(bar.date ?? '').slice(0, 10);
  console.log(`\n  ── Indicateurs au ${date} ──\n`);

  // Moyennes mobiles
  const mas = [['SMA20',bar.sma20],['SMA50',bar.sma50],['SMA200',bar.sma200],
               ['EMA9',bar.ema9],['EMA20',bar.ema20],['EMA50',bar.ema50],['EMA200',bar.ema200]].filter(([,v])=>v!=null);
  if (mas.length) {
    console.log('  MOYENNES MOBILES');
    for (const [k,v] of mas) console.log(`    ${k.padEnd(8)} ${f(v)}`);
  }

  // Momentum
  console.log('\n  MOMENTUM / OSCILLATEURS');
  if (bar.rsi   != null) console.log(`    RSI(14)  ${f(bar.rsi,1).padStart(7)}  ${bar.rsi > 70 ? '🔴 Overbought' : bar.rsi < 30 ? '🟢 Oversold' : '⚪ Neutre'}`);
  if (bar.macd  != null) console.log(`    MACD     ${f(bar.macd).padStart(7)}  Signal: ${f(bar.macdSignal)}  Histo: ${f(bar.macdHistogram ?? bar.hist)}`);
  if (bar.stochK!= null) console.log(`    Stoch    K:${f(bar.stochK,1)}  D:${f(bar.stochD,1)}`);
  if (bar.cci   != null) console.log(`    CCI(20)  ${f(bar.cci,1).padStart(7)}`);
  if (bar.rsi14 != null && bar.rsi == null) console.log(`    RSI      ${f(bar.rsi14,1).padStart(7)}`);
  if (bar.adx   != null) console.log(`    ADX(14)  ${f(bar.adx,1).padStart(7)}  ${bar.adx > 25 ? '💪 Forte tendance' : '📉 Tendance faible'}`);
  if (bar.williamsR != null) console.log(`    Williams ${f(bar.williamsR,1).padStart(7)}`);
  if (bar.mfi   != null) console.log(`    MFI(14)  ${f(bar.mfi,1).padStart(7)}`);
  if (bar.roc   != null) console.log(`    ROC(12)  ${f(bar.roc,2).padStart(7)}%`);

  // Volatilité
  console.log('\n  VOLATILITÉ');
  if (bar.bbUpper != null) console.log(`    Bollinger  Sup:${f(bar.bbUpper)}  Mid:${f(bar.bbMiddle)}  Inf:${f(bar.bbLower)}  Width:${f(bar.bbWidth,4)}`);
  if (bar.atr     != null) console.log(`    ATR(14)    ${f(bar.atr)}`);
  if (bar.keltnerUpper != null) console.log(`    Keltner    Sup:${f(bar.keltnerUpper)}  Mid:${f(bar.keltnerMiddle)}  Inf:${f(bar.keltnerLower)}`);

  // Volume
  console.log('\n  VOLUME');
  if (bar.vwap != null) console.log(`    VWAP   ${f(bar.vwap)}`);
  if (bar.obv  != null) console.log(`    OBV    ${fv(bar.obv)}`);
  if (bar.cmf  != null) console.log(`    CMF(20) ${f(bar.cmf,4)}`);

  // Pivots
  if (bar.pivotPP != null) {
    console.log('\n  PIVOT POINTS (classique)');
    console.log(`    PP:${f(bar.pivotPP)}  R1:${f(bar.pivotR1)}  R2:${f(bar.pivotR2)}  R3:${f(bar.pivotR3)}`);
    console.log(`                   S1:${f(bar.pivotS1)}  S2:${f(bar.pivotS2)}  S3:${f(bar.pivotS3)}`);
  }

  // 52-week
  if (bar.week52High != null) {
    console.log('\n  52 SEMAINES');
    console.log(`    High: ${f(bar.week52High)}  Low: ${f(bar.week52Low)}  Position: ${f(bar.week52Pct,1)}% du range`);
  }
  console.log();
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  addIndicators,
  sma,
  ema,
  wma,
  rsi,
  macd,
  bollingerBands,
  atr,
  vwap,
  obv,
  stochastic,
  adx,
  cci,
  williams,
  roc,
  momentum,
  mfi,
  keltnerChannels,
  ichimoku,
  cmf,
  pivotPoints,
  fiftyTwoWeek,
  printIndicators
};
