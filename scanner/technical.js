/**
 * TREADING AI — Technical Analysis Engine (Backend Port)
 *
 * This is a pure-Node.js port of src/logic/technical.js from the React frontend.
 * It runs on the Node.js backend server for 24/7 autonomous scanning.
 *
 * Uses the `technicalindicators` npm package (same as frontend).
 *
 * WEIGHT DISTRIBUTION:
 *  1. Market Structure (HH/HL/LH/LL)  → 25%
 *  2. Support / Resistance Zones       → 20%
 *  3. Volume Flow / Profile            → 15%
 *  4. Liquidity Sweeps / EQH / EQL    → 15%
 *  5. Momentum (RSI + MACD)            → 10%
 *  6. Volatility / ATR                 → 10%
 *  7. VWAP Bias                        → 5%
 *  8. Orderbook Imbalance              → 10%
 *  9. EMA 200 Trend Alignment         → Required for Elites
 */

import { EMA, ATR, RSI, MACD, VWAP } from 'technicalindicators';

// ═══════════════════════════════════════════════════════════════
// MODULE 1: SUPPORT / RESISTANCE
// ═══════════════════════════════════════════════════════════════

export function detectSR(candles) {
    const rawSupports = [];
    const rawResistances = [];

    for (let i = 2; i < candles.length - 2; i++) {
        if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
            rawSupports.push(candles[i].low);
        }
        if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
            rawResistances.push(candles[i].high);
        }
    }

    const cluster = (points, threshold = 0.002) => {
        const zones = [];
        points.forEach(p => {
            const existing = zones.find(z => Math.abs(z.price - p) / p < threshold);
            if (existing) {
                existing.hits++;
                existing.price = (existing.price * (existing.hits - 1) + p) / existing.hits;
            } else {
                zones.push({ price: p, hits: 1 });
            }
        });
        return zones.sort((a, b) => b.hits - a.hits);
    };

    const instSupports = cluster(rawSupports);
    const instResistances = cluster(rawResistances);
    const strongSupports = instSupports.filter(z => z.hits >= 3);
    const strongResistances = instResistances.filter(z => z.hits >= 3);

    return {
        supports: instSupports.map(z => z.price),
        resistances: instResistances.map(z => z.price),
        institutionalZones: { supports: instSupports, resistances: instResistances, strongSupports, strongResistances }
    };
}

export function srScore(price, supports, resistances, institutionalZones) {
    if (supports.length === 0 || resistances.length === 0) return 50;

    const nearestSupport = supports.reduce((prev, curr) =>
        Math.abs(curr - price) < Math.abs(prev - price) ? curr : prev);
    const nearestResistance = resistances.reduce((prev, curr) =>
        Math.abs(curr - price) < Math.abs(prev - price) ? curr : prev);

    const distSupport = Math.abs(price - nearestSupport) / price;
    const distResistance = Math.abs(price - nearestResistance) / price;

    const isStrongSupport = institutionalZones?.strongSupports?.some(z =>
        Math.abs(z.price - nearestSupport) / nearestSupport < 0.001);
    const isStrongResistance = institutionalZones?.strongResistances?.some(z =>
        Math.abs(z.price - nearestResistance) / nearestResistance < 0.001);

    if (distSupport < 0.003) return isStrongSupport ? 88 : 75;
    if (distResistance < 0.003) return isStrongResistance ? 15 : 28;
    return 50;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 2: MARKET STRUCTURE
// ═══════════════════════════════════════════════════════════════

export function detectMarketStructure(candles) {
    if (candles.length < 50) return { structure: 'RANGE', detail: 'Insufficient data', score: 50 };

    const last = candles.slice(-8);
    const highs = last.map(c => c.high);
    const lows = last.map(c => c.low);

    const recentHigh = Math.max(highs[5], highs[6], highs[7]);
    const priorHigh = Math.max(highs[2], highs[3], highs[4]);
    const recentLow = Math.min(lows[5], lows[6], lows[7]);
    const priorLow = Math.min(lows[2], lows[3], lows[4]);

    const isHH = recentHigh > priorHigh;
    const isHL = recentLow > priorLow;
    const isLH = recentHigh < priorHigh;
    const isLL = recentLow < priorLow;

    const prices = candles.map(c => c.close);
    const ema20 = EMA.calculate({ values: prices, period: 20 });
    const ema50 = EMA.calculate({ values: prices, period: 50 });
    const isBullishEMA = ema20[ema20.length - 1] > ema50[ema50.length - 1];

    let score = 50, structure = 'RANGE', detail = 'Consolidation';

    if (isHH && isHL) { structure = 'BULLISH'; detail = 'HH + HL'; score = isBullishEMA ? 85 : 72; }
    else if (isLH && isLL) { structure = 'BEARISH'; detail = 'LH + LL'; score = !isBullishEMA ? 15 : 28; }
    else if (isBullishEMA) { structure = 'BULLISH'; detail = 'EMA Support'; score = 65; }
    else { structure = 'BEARISH'; detail = 'EMA Resistance'; score = 35; }

    return { structure, detail, score };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 3: MOMENTUM (RSI + MACD)
// ═══════════════════════════════════════════════════════════════

export function calculateMomentum(candles) {
    const prices = candles.map(c => c.close);
    if (prices.length < 26) return 50;

    const rsiValues = RSI.calculate({ values: prices, period: 14 });
    const lastRSI = rsiValues[rsiValues.length - 1] ?? 50;

    const macdValues = MACD.calculate({ values: prices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastMACD = macdValues[macdValues.length - 1];
    const prevMACD = macdValues[macdValues.length - 2];

    let score = 50;
    if (lastRSI > 55) { score += 15; if (lastRSI > 70) score += 7; }
    else if (lastRSI < 45) { score -= 15; if (lastRSI < 30) score -= 7; }
    else { score = 50; }

    if (lastMACD && prevMACD) {
        if (lastMACD.histogram > 0 && lastMACD.histogram > prevMACD.histogram) score += 12;
        else if (lastMACD.histogram > 0) score += 5;
        else if (lastMACD.histogram < 0 && lastMACD.histogram < prevMACD.histogram) score -= 12;
        else if (lastMACD.histogram < 0) score -= 5;
        if (prevMACD.histogram < 0 && lastMACD.histogram > 0) score += 8;
        if (prevMACD.histogram > 0 && lastMACD.histogram < 0) score -= 8;
    }

    return Math.min(Math.max(Math.round(score), 0), 100);
}

// ═══════════════════════════════════════════════════════════════
// MODULE 4: VOLUME FLOW
// ═══════════════════════════════════════════════════════════════

export function detectVolumeFlow(candles) {
    if (candles.length < 20) return { score: 50, label: 'Normal' };

    const last20 = candles.slice(-20);
    const avgVolume = last20.reduce((sum, c) => sum + c.volume, 0) / 20;
    const currentVol = candles[candles.length - 1].volume;
    const lastCandle = candles[candles.length - 1];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const volRatio = currentVol / avgVolume;

    const last5 = candles.slice(-5);
    let obvScore = 50;
    last5.forEach(c => { if (c.close > c.open) obvScore += 4; else if (c.close < c.open) obvScore -= 4; });

    let score = obvScore;
    if (volRatio > 2.0) { score += isBullishCandle ? 18 : -18; }
    else if (volRatio > 1.5) { score += isBullishCandle ? 10 : -10; }
    else if (volRatio < 0.5) { score = 50; }

    const label = volRatio > 1.5 ? (isBullishCandle ? 'Buy Surge' : 'Sell Surge') : 'Normal';
    return { score: Math.min(Math.max(Math.round(score), 0), 100), label, volRatio: volRatio.toFixed(2) };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 5: LIQUIDITY SWEEP
// ═══════════════════════════════════════════════════════════════

export function detectLiquiditySweep(candles) {
    if (candles.length < 10) return null;
    const last = candles[candles.length - 1];
    const previousRange = candles.slice(-11, -1);
    const minLow = Math.min(...previousRange.map(c => c.low));
    const maxHigh = Math.max(...previousRange.map(c => c.high));
    if (last.low < minLow && last.close > minLow) return { type: 'Bullish Liquidity Sweep', direction: 'BULLISH', sweepDepth: `${((minLow - last.low) / last.low * 100).toFixed(3)}%` };
    if (last.high > maxHigh && last.close < maxHigh) return { type: 'Bearish Liquidity Sweep', direction: 'BEARISH', sweepDepth: `${((last.high - maxHigh) / maxHigh * 100).toFixed(3)}%` };
    return null;
}

export function liquidityZoneScore(candles) {
    const sweep = detectLiquiditySweep(candles);
    if (!sweep) return 50;
    if (sweep.direction === 'BULLISH') return 82;
    if (sweep.direction === 'BEARISH') return 22;
    return 50;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 6: VOLATILITY / ATR
// ═══════════════════════════════════════════════════════════════

export function volatilityScore(candles) {
    if (candles.length < 14) return 50;
    const high = candles.map(c => c.high), low = candles.map(c => c.low), close = candles.map(c => c.close);
    const atrValues = ATR.calculate({ high, low, close, period: 14 });
    const atrPercent = (atrValues[atrValues.length - 1] / close[close.length - 1]) * 100;
    if (atrPercent < 0.3) return 75;
    if (atrPercent < 0.8) return 65;
    if (atrPercent < 1.5) return 55;
    if (atrPercent < 2.5) return 38;
    return 25;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 7: VWAP BIAS
// ═══════════════════════════════════════════════════════════════

export function calculateVWAP(candles) {
    if (candles.length < 5) return { current: 0, bias: 'Neutral', score: 50 };
    const high = candles.map(c => c.high), low = candles.map(c => c.low), close = candles.map(c => c.close), volume = candles.map(c => c.volume);
    const vwapValues = VWAP.calculate({ high, low, close, volume });
    const currentVWAP = vwapValues[vwapValues.length - 1];
    const lastPrice = close[close.length - 1];
    const bias = lastPrice > currentVWAP ? 'Bullish' : 'Bearish';
    return { current: currentVWAP, bias, score: bias === 'Bullish' ? 75 : 25 };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 8: VOLUME PROFILE / POC
// ═══════════════════════════════════════════════════════════════

export function calculateVolumeProfile(candles, bins = 20) {
    if (candles.length < 10) return { poc: 0, vah: 0, val: 0, score: 50 };
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;
    if (range === 0) return { poc: minPrice, vah: minPrice, val: minPrice, score: 50 };
    const binSize = range / bins;
    const profile = Array(bins).fill(0).map((_, i) => ({ price: minPrice + i * binSize, volume: 0 }));
    candles.forEach(c => {
        const idx = Math.min(Math.floor((c.close - minPrice) / binSize), bins - 1);
        profile[idx].volume += c.volume;
    });
    let maxVol = 0, pocIndex = 0;
    profile.forEach((p, i) => { if (p.volume > maxVol) { maxVol = p.volume; pocIndex = i; } });
    const poc = profile[pocIndex].price;
    const totalVolume = profile.reduce((s, p) => s + p.volume, 0);
    let currentVolume = maxVol, lowIndex = pocIndex, highIndex = pocIndex;
    while (currentVolume < totalVolume * 0.70 && (lowIndex > 0 || highIndex < bins - 1)) {
        const volBelow = lowIndex > 0 ? profile[lowIndex - 1].volume : 0;
        const volAbove = highIndex < bins - 1 ? profile[highIndex + 1].volume : 0;
        if (volAbove >= volBelow && highIndex < bins - 1) { highIndex++; currentVolume += volAbove; }
        else if (lowIndex > 0) { lowIndex--; currentVolume += volBelow; }
        else break;
    }
    const vah = profile[highIndex].price, val = profile[lowIndex].price;
    const lastPrice = candles[candles.length - 1].close;
    let score = 50;
    if (Math.abs(lastPrice - poc) / lastPrice < 0.002) score += 15;
    if (lastPrice > vah) score += 10;
    else if (lastPrice < val) score -= 10;
    return { poc, vah, val, score };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 9: EQUAL HIGHS / EQUAL LOWS
// ═══════════════════════════════════════════════════════════════

export function detectEqualHighsLows(candles, tolerance = 0.001) {
    if (candles.length < 20) return { eqh: false, eql: false, score: 50 };
    const last = candles[candles.length - 1];
    const lookback = candles.slice(-50, -1);
    const peaks = [], valleys = [];
    for (let i = 2; i < lookback.length - 2; i++) {
        if (lookback[i].high > lookback[i - 1].high && lookback[i].high > lookback[i + 1].high) peaks.push(lookback[i].high);
        if (lookback[i].low < lookback[i - 1].low && lookback[i].low < lookback[i + 1].low) valleys.push(lookback[i].low);
    }
    let eqh = false, eql = false;
    for (let i = 0; i < peaks.length; i++) for (let j = i + 1; j < peaks.length; j++) if (Math.abs(peaks[i] - peaks[j]) / peaks[i] < tolerance) { eqh = true; break; }
    for (let i = 0; i < valleys.length; i++) for (let j = i + 1; j < valleys.length; j++) if (Math.abs(valleys[i] - valleys[j]) / valleys[i] < tolerance) { eql = true; break; }
    let score = 50;
    if (eqh && last.close > Math.max(...peaks, last.close)) score -= 10;
    if (eql && last.close < Math.min(...valleys, last.close)) score += 10;
    return { eqh, eql, score };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 10: MARKET REGIME DETECTION
// ═══════════════════════════════════════════════════════════════

export function detectMarketRegime(candles) {
    if (candles.length < 30) return 'RANGING';
    const prices = candles.map(c => c.close);
    const ema20 = EMA.calculate({ values: prices, period: 20 });
    const ema50 = EMA.calculate({ values: prices, period: 50 });
    const high = candles.map(c => c.high), low = candles.map(c => c.low);
    const atr = ATR.calculate({ high, low, close: prices, period: 14 });
    const atrPct = (atr[atr.length - 1] / prices[prices.length - 1]) * 100;
    if (atrPct > 2.0) return 'VOLATILE';
    const emaDiff = (ema20[ema20.length - 1] - ema50[ema50.length - 1]) / ema50[ema50.length - 1];
    if (Math.abs(emaDiff) > 0.003) return emaDiff > 0 ? 'BULLISH TREND' : 'BEARISH TREND';
    return 'RANGING';
}

// ═══════════════════════════════════════════════════════════════
// MODULE 11: SESSION FILTER
// ═══════════════════════════════════════════════════════════════

export function getSession(timestamp) {
    const date = new Date(timestamp * 1000);
    const hour = date.getUTCHours();
    if (hour >= 8 && hour < 12) return 'LONDON';
    if (hour >= 13 && hour < 17) return 'NEW YORK';
    if (hour >= 0 && hour < 8) return 'ASIA';
    return 'DORMANT';
}

// ═══════════════════════════════════════════════════════════════
// INSTITUTIONAL MODULE: ORDER BLOCKS
// ═══════════════════════════════════════════════════════════════

export function detectOrderBlocks(candles) {
    if (candles.length < 10) return null;
    const last10 = candles.slice(-10);
    const bodies = last10.map(c => Math.abs(c.close - c.open));
    const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
    for (let i = 0; i < last10.length - 2; i++) {
        const c1 = last10[i], c2 = last10[i + 1];
        if (Math.abs(c1.close - c1.open) < avgBody * 1.8) continue;
        if (c1.close < c1.open && (c2.close - c2.open) / c2.open > 0.005) return { type: 'Bullish OB', price: c1.low, zone: `${c1.low.toFixed(2)} – ${c1.high.toFixed(2)}`, direction: 'BULLISH' };
        if (c1.close > c1.open && (c1.open - c2.close) / c1.open > 0.005) return { type: 'Bearish OB', price: c1.high, zone: `${c1.low.toFixed(2)} – ${c1.high.toFixed(2)}`, direction: 'BEARISH' };
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// CANDLESTICK PATTERNS
// ═══════════════════════════════════════════════════════════════

export function detectCandlePattern(candles) {
    if (candles.length < 3) return { score: 50, type: null };
    const last = candles[candles.length - 1], prev = candles[candles.length - 2], prev2 = candles[candles.length - 3];
    const isLastBullish = last.close > last.open, isLastBearish = last.close < last.open;
    const isPrevBullish = prev.close > prev.open, isPrevBearish = prev.close < prev.open;
    const bodySize = Math.abs(last.close - last.open), totalRange = last.high - last.low;
    const lowerWick = Math.min(last.open, last.close) - last.low, upperWick = last.high - Math.max(last.open, last.close);
    if (isLastBullish && isPrevBearish && last.close > prev.open && last.open < prev.close) return { score: 88, type: 'BULLISH_ENGULFING' };
    if (isLastBearish && isPrevBullish && last.close < prev.open && last.open > prev.close) return { score: 18, type: 'BEARISH_ENGULFING' };
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && totalRange > 0) return { score: 78, type: 'HAMMER' };
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && totalRange > 0) return { score: 22, type: 'SHOOTING_STAR' };
    if (prev2.close < prev2.open && Math.abs(prev.close - prev.open) < (prev.high - prev.low) * 0.3 && isLastBullish && last.close > (prev2.open + prev2.close) / 2) return { score: 85, type: 'MORNING_STAR' };
    if (prev2.close > prev2.open && Math.abs(prev.close - prev.open) < (prev.high - prev.low) * 0.3 && isLastBearish && last.close < (prev2.open + prev2.close) / 2) return { score: 18, type: 'EVENING_STAR' };
    if (bodySize < totalRange * 0.1 && totalRange > 0) return { score: 50, type: 'DOJI' };
    return { score: 50, type: null };
}

// ═══════════════════════════════════════════════════════════════
// MODULE 12: ORDERBOOK IMBALANCE
// ═══════════════════════════════════════════════════════════════

export function calculateOrderbookImbalance(depth) {
    if (!depth || !depth.bids || !depth.asks || depth.bids.length === 0) {
        return { score: 50, imbalance: 0, label: 'Neutral' };
    }

    // Sum volume of top 20 levels
    const bidVol = depth.bids.slice(0, 20).reduce((sum, level) => sum + level[1], 0);
    const askVol = depth.asks.slice(0, 20).reduce((sum, level) => sum + level[1], 0);

    const total = bidVol + askVol;
    if (total === 0) return { score: 50, imbalance: 0, label: 'Neutral' };

    const imbalance = (bidVol - askVol) / total; // Range -1 to 1

    // Convert to score 0 - 100
    // +1 (Pure Bids) -> 100
    // -1 (Pure Asks) -> 0
    let score = 50 + (imbalance * 50);

    let label = 'Neutral';
    if (imbalance > 0.3) label = 'Buy Pressure';
    else if (imbalance < -0.3) label = 'Sell Pressure';

    return {
        score: Math.round(score),
        imbalance: imbalance.toFixed(2),
        label,
        bidVol: bidVol.toFixed(1),
        askVol: askVol.toFixed(1)
    };
}

// ═══════════════════════════════════════════════════════════════
// BREAKOUT PROBABILITY ENGINE
// ═══════════════════════════════════════════════════════════════

export function calculateBreakoutProbability(candles, volumeScore_, momentumScore_, volatilityScore_) {
    if (candles.length < 20) return 50;
    const rawProb = (volumeScore_ + momentumScore_ + volatilityScore_) / 3;
    const last = candles[candles.length - 1];
    const { resistances } = detectSR(candles);
    const aboveCurrentPrice = resistances.filter(r => r > last.close);
    const nearestResistance = aboveCurrentPrice.length > 0 ? Math.min(...aboveCurrentPrice) : null;
    let bonus = 0;
    if (nearestResistance) {
        const dist = (nearestResistance - last.close) / last.close;
        if (dist < 0.003) bonus = 8;
        else if (dist < 0.008) bonus = 4;
    }
    return Math.min(Math.max(Math.round(rawProb + bonus), 0), 100);
}

export function getTradeSignal(score) {
    if (score >= 78) return 'STRONG BUY';
    if (score >= 62) return 'BUY';
    if (score >= 44) return 'WAIT';
    if (score >= 30) return 'SELL';
    return 'STRONG SELL';
}

// ═══════════════════════════════════════════════════════════════
// MASTER ENGINE: runAIAnalysis
// ═══════════════════════════════════════════════════════════════

export function runAIAnalysis(candles, timeframe = '15m', symbol = 'Unknown', futuresData = null) {
    if (!candles || candles.length < 20) return { error: 'Insufficient data' };

    const currentPrice = candles[candles.length - 1].close;
    const prices = candles.map(c => c.close);
    const { supports, resistances, institutionalZones } = detectSR(candles);

    const vwapData = calculateVWAP(candles);
    const volProfile = calculateVolumeProfile(candles);
    const eqHL = detectEqualHighsLows(candles);
    const regime = detectMarketRegime(candles);
    const session = getSession(candles[candles.length - 1].time);

    const marketStructureData = detectMarketStructure(candles);
    const marketStructureScore = marketStructureData.score;
    const srRating = srScore(currentPrice, supports, resistances, institutionalZones);
    const volumeData = detectVolumeFlow(candles);
    const volumeScore = (volumeData.score + volProfile.score) / 2;
    const liqScore = (liquidityZoneScore(candles) + eqHL.score) / 2;
    const momentumScore = calculateMomentum(candles);
    const volScore = volatilityScore(candles);
    const vwapScore = vwapData.score;

    // Orderbook (Module 12)
    const orderbookData = calculateOrderbookImbalance(futuresData?.depth);
    const orderbookScore = orderbookData.score;

    // ── EMA 200 Trend Check ──
    const ema200Arr = EMA.calculate({ values: prices, period: 200 });
    const ema200 = ema200Arr[ema200Arr.length - 1];

    // Preliminary confidence based on technicals
    const confidence =
        marketStructureScore * 0.25 +
        srRating * 0.15 +
        volumeScore * 0.15 +
        liqScore * 0.10 +
        momentumScore * 0.10 +
        volScore * 0.10 +
        vwapScore * 0.05 +
        orderbookScore * 0.10;

    // ── SESSION FILTER ──
    const hour = new Date().getUTCHours();
    const isLondon = hour >= 7 && hour <= 12;
    const isNY = hour >= 13 && hour <= 20;

    let sessionBonus = 0;
    if (isLondon || isNY) sessionBonus = 5;
    else sessionBonus = -10;

    const probability = Math.round(Math.min(Math.max(confidence + sessionBonus, 0), 100));

    // Preliminary action to check trend alignment
    const initialAction = probability >= 65 ? 'BUY' : (probability <= 35 ? 'SELL' : 'WAIT');

    // Filter signals against EMA 200 Trend
    const trendAlign = (initialAction === 'BUY' && currentPrice > ema200) ||
        (initialAction === 'SELL' && currentPrice < ema200);

    let futuresScore = 50;
    if (futuresData && futuresData.openInterest > 0) {
        const isPriceUp = currentPrice > candles[candles.length - 2].close;
        const isBullish = marketStructureScore > 50;
        if (isPriceUp && isBullish) futuresScore = 100;
        else if (!isPriceUp && !isBullish) futuresScore = 0;
    }

    // ── STEP 5: Risk & Alignment ──────────────────────────────
    const liquiditySweep = detectLiquiditySweep(candles);
    const orderBlock = detectOrderBlocks(candles);
    const patternData = detectCandlePattern(candles);
    const breakoutProb = calculateBreakoutProbability(candles, volumeScore, momentumScore, volScore);

    const high = candles.map(c => c.high), low = candles.map(c => c.low);
    const atrArr = ATR.calculate({ high, low, close: prices, period: 14 });
    const currentATR = atrArr[atrArr.length - 1] ?? currentPrice * 0.01;
    const atrPct = (currentATR / currentPrice) * 100;

    // ── ADAPTIVE THRESHOLD (New Improvement) ───────────────
    // If volatility is high, we lower the threshold to catch the move earlier.
    // If volatility is low, we raise it to avoid fakeouts in the noise.
    let trendThreshold = 65;
    if (atrPct > 1.2) trendThreshold = 62; // Faster entry in volatile markets
    else if (atrPct < 0.3) trendThreshold = 72; // Strict entry in slow markets

    const isRegimeAligned = (initialAction === 'BUY' && regime.includes('BULLISH')) ||
        (initialAction === 'SELL' && regime.includes('BEARISH')) || (regime === 'RANGING');

    const last20 = candles.slice(-20);
    const avgVol = last20.reduce((s, c) => s + c.volume, 0) / 20;
    const isVolumeSpike = candles[candles.length - 1].volume > avgVol * 1.5;

    let adjustedProb = confidence + sessionBonus;
    if (isVolumeSpike) adjustedProb += 8;
    if (trendAlign) adjustedProb += 5;
    if (isVolumeSpike && liquiditySweep) adjustedProb += 5;

    // ── Breakout Probability & Resistance Check ──
    const abovePrice = resistances.filter(r => r > currentPrice);
    const nearestResistance = abovePrice.length > 0 ? Math.min(...abovePrice) : currentPrice * 1.02;

    // Breakout logic: Price > Resistance + Volume Spike + Orderbook
    const isBreakout = (currentPrice > nearestResistance && isVolumeSpike && parseFloat(orderbookData.imbalance || 0) > 0.3);
    if (isBreakout) adjustedProb += 12;

    adjustedProb = Math.min(Math.max(Math.round(adjustedProb), 0), 100);

    // ── CONFLUENCE FILTER (Enhanced) ──────────────────────────
    const factors = [];
    if (marketStructureScore > 60) factors.push('Trend Alignment');
    if (srRating > 60) factors.push('S/R Bounce');
    if (isVolumeSpike) factors.push('Volume Spike');
    if (orderbookData.score > 65) factors.push('Orderbook Bids+');
    if (orderbookData.score < 35) factors.push('Orderbook Asks+');
    if (liquiditySweep) factors.push('Liquidity Sweep');
    if (trendAlign) factors.push('EMA 200 Confluence');

    // Elite Quality: Final score adjusted by confluence count
    if (factors.length >= 4) adjustedProb += 15;
    adjustedProb = Math.min(Math.round(adjustedProb), 100);

    let finalAction = adjustedProb >= trendThreshold ? 'BUY' : (adjustedProb <= (100 - trendThreshold) ? 'SELL' : 'WAIT');

    // Filter signals against EMA 200 Trend
    if (finalAction === 'BUY' && currentPrice < ema200) finalAction = 'WAIT';
    if (finalAction === 'SELL' && currentPrice > ema200) finalAction = 'WAIT';

    if (finalAction !== 'WAIT' && (factors.length < 3 || atrPct < 0.12)) {
        finalAction = 'WAIT';
    }

    const lastCandle = candles[candles.length - 1];
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    if (finalAction === 'BUY' && upperWick > bodySize * 1.8) finalAction = 'WAIT';
    else if (finalAction === 'SELL' && lowerWick > bodySize * 1.8) finalAction = 'WAIT';

    const isTrendSignal = adjustedProb >= trendThreshold || adjustedProb <= (100 - trendThreshold);
    const isBreakoutSignal = (adjustedProb > 60 || adjustedProb < 40) && isVolumeSpike && liquiditySweep;

    let strengthLabel = 'Normal';
    const confidenceScore = Math.abs(adjustedProb - 50) * 2;
    if (confidenceScore > 85) strengthLabel = 'Institutional';
    else if (confidenceScore > 70) strengthLabel = 'Strong';
    else if (confidenceScore < 40) strengthLabel = 'Weak';

    // ── RISK MODEL (TP/SL) ───────────────────────────
    let slVal = finalAction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
    let tp1 = finalAction === 'BUY' ? currentPrice + currentATR * 2.0 : currentPrice - currentATR * 2.0;
    let tp2 = finalAction === 'BUY' ? currentPrice + currentATR * 4.0 : currentPrice - currentATR * 4.0;

    let targetType = 'Volatility Expansion';

    if (finalAction === 'BUY') {
        if (volProfile.vah > currentPrice) { tp1 = volProfile.vah; targetType = 'Volume VAH'; }
    } else if (finalAction === 'SELL') {
        if (volProfile.val < currentPrice) { tp1 = volProfile.val; targetType = 'Volume VAL'; }
    }

    const ema20Arr = EMA.calculate({ values: prices, period: 20 });
    const ema50Arr = EMA.calculate({ values: prices, period: 50 });
    const rsiValues = RSI.calculate({ values: prices, period: 14 });
    const currentRSI = (rsiValues[rsiValues.length - 1] ?? 50).toFixed(1);

    // Expiry: 15 minutes for scalping
    const expiresInMs = 15 * 60 * 1000;

    return {
        symbol,
        timeframe,
        action: finalAction,
        score: adjustedProb,
        price: currentPrice,
        stopLoss: parseFloat(slVal.toFixed(8)),
        target: parseFloat(tp1.toFixed(8)),
        target2: parseFloat(tp2.toFixed(8)),
        targetType,
        strengthLabel,
        riskReward: '1:2.0',
        currentRSI,
        isVolumeSpike,
        factors,
        trend: marketStructureScore > 60 ? 'Bullish' : marketStructureScore < 40 ? 'Bearish' : 'Neutral',
        patterns: patternData.type,
        timestamp: Date.now(),
        expiresAt: Date.now() + expiresInMs,
        isRegimeAligned,
        isTrendSignal,
        isBreakoutSignal,
        strategyScores: {
            sr: Math.round(srRating),
            marketStructure: Math.round(marketStructureScore),
            momentum: Math.round(momentumScore),
            volumeFlow: Math.round(volumeScore),
            liquidityZones: Math.round(liqScore),
            volatility: Math.round(volScore),
            vwapBias: Math.round(vwapScore),
            orderbook: Math.round(orderbookScore),
            futures: Math.round(futuresScore)
        },
        institutional: {
            liquidity: liquiditySweep?.type ?? null,
            liquidityDir: liquiditySweep?.direction ?? null,
            orderBlock: orderBlock?.type ?? null,
            orderBlockZone: orderBlock?.zone ?? null,
            breakoutProb,
            vwap: vwapData.current.toFixed(8),
            vwapBias: vwapData.bias,
            poc: volProfile.poc,
            vah: volProfile.vah,
            val: volProfile.val,
            regime,
            session,
            eqh: eqHL.eqh,
            eql: eqHL.eql,
            orderbook: orderbookData,
            fundingRate: futuresData?.fundingRate ?? '0.0000',
            openInterest: futuresData?.openInterest ?? 0
        }
    };
}
