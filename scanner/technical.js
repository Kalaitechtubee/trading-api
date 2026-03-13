/**
 * TREADING AI — Technical Analysis Engine (Backend Port)
 *
 * This is a pure-Node.js port of src/logic/technical.js from the React frontend.
 * It runs on the Node.js backend server for 24/7 autonomous scanning.
 *
 * Uses the `technicalindicators` npm package (same as frontend).
 *
 * WEIGHT DISTRIBUTION (v2 — Smart Money Edition):
 *  1. Market Structure (HH/HL/LH/LL)  → 25%
 *  2. Liquidity Zones + Clusters       → 20%
 *  3. Volume Flow / Orderflow Delta    → 15%
 *  4. Momentum (RSI + MACD)            → 10%
 *  5. Support / Resistance             → 10%
 *  6. Orderbook Imbalance + Whales     → 10%
 *  7. Smart Money (BOS + OB)           → 10%
 *  8. ML Prediction (Bonus)            → +8 bonus pts if > 70%
 *  9. VWAP / EMA 200                   → Filter / Required
 */

import { EMA, ATR, RSI, MACD, VWAP, ADX } from 'technicalindicators';
import {
    detectLiquidityClusters,
    detectWhales,
    detectBOS,
    calculateOrderflow,
    getMLPrediction,
    buildMLFeatures
} from './smartMoney.js';
import riskConfig from '../config/riskConfig.js';

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

    // Buy/Sell Delta (Institutional)
    const buyVol = lastCandle.buyVolume || 0;
    const sellVol = lastCandle.volume - buyVol;
    const delta = buyVol - sellVol;
    const deltaPct = lastCandle.volume > 0 ? (delta / lastCandle.volume) * 100 : 0;

    return {
        score: Math.min(Math.max(Math.round(score), 0), 100),
        label,
        volRatio: volRatio.toFixed(2),
        deltaPct: deltaPct.toFixed(1) + '%',
        isHighDelta: Math.abs(deltaPct) > 20
    };
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

    // Updated Session Windows (UTC)
    if (hour >= 7 && hour < 12) return 'LONDON_OPEN'; // High Volatility + Trends
    if (hour >= 12 && hour < 16) return 'NY_OVERLAP'; // Highest Volatility
    if (hour >= 16 && hour < 20) return 'NEW_YORK';   // Moderate Trend
    if (hour >= 0 && hour < 7) return 'ASIA';         // Range Bound
    if (hour >= 20 || hour < 0) return 'LATE_NY';    // Low Liquidity / Fake Moves
    return 'DORMANT';
}

/**
 * Time-Based Volatility Analysis
 * Calculates movement, trend probability, and range probability per hour
 */
export function analyzeTimeVolatility(candles) {
    const hourlyStats = {};

    candles.forEach(c => {
        const hour = new Date(c.time * 1000).getUTCHours();

        if (!hourlyStats[hour]) {
            hourlyStats[hour] = {
                count: 0,
                movement: 0,
                trendMoves: 0,
                rangeMoves: 0
            };
        }

        const move = Math.abs(c.close - c.open) / c.open;

        hourlyStats[hour].movement += move;
        hourlyStats[hour].count++;

        // Threshold of 0.4% move is considered a "trend move" for scalping
        if (move > 0.004) {
            hourlyStats[hour].trendMoves++;
        } else {
            hourlyStats[hour].rangeMoves++;
        }
    });

    const results = {};

    Object.keys(hourlyStats).forEach(h => {
        const s = hourlyStats[h];

        results[h] = {
            avgMove: (s.movement / s.count).toFixed(5),
            trendRatio: (s.trendMoves / s.count * 100).toFixed(1) + '%',
            rangeRatio: (s.rangeMoves / s.count * 100).toFixed(1) + '%'
        };
    });

    return results;
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

export async function runAIAnalysis(candles, timeframe = '15m', symbol = 'Unknown', futuresData = null) {
    if (!candles || candles.length < 200) return { error: `Insufficient data: ${candles?.length ?? 0} candles (need 200)` };

    // Forex does not support orderbook, funding rate, or open interest
    if (symbol.includes("/")) {
        futuresData = null;
    }

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

    // ── Indicator Pre-calculation (Fixed for ReferenceError) ──
    const rsiValues = RSI.calculate({ values: prices, period: 14 });
    const ema200Arr = EMA.calculate({ values: prices, period: 200 });
    const ema200 = ema200Arr[ema200Arr.length - 1];

    const high = candles.map(c => c.high), low = candles.map(c => c.low);
    const atrArr = ATR.calculate({ high, low, close: prices, period: 14 });
    const currentATR = atrArr[atrArr.length - 1] ?? currentPrice * 0.01;
    const atrPct = (currentATR / currentPrice) * 100;

    const last20 = candles.slice(-20);
    const avgVol = last20.reduce((s, c) => s + c.volume, 0) / 20;
    const isVolumeSpike = candles[candles.length - 1].volume > avgVol * 1.5;

    // ── Futures Confirmation Score (Weight: 5%) ──
    let futuresScore = 50;
    if (futuresData && futuresData.openInterest > 0) {
        const isPriceUp = currentPrice > candles[candles.length - 2].close;
        const isBullishMS = marketStructureData.score > 50;
        if (isPriceUp && isBullishMS) futuresScore = 100;
        else if (!isPriceUp && !isBullishMS) futuresScore = 0;
    }

    // Orderbook (Module 12)
    const orderbookData = calculateOrderbookImbalance(futuresData?.depth);
    const orderbookScore = orderbookData.score;

    // ── SMART MONEY MODULES ──────────────────────────────────────
    // Module SM-1: Liquidity Clusters (Heatmap)
    const clusterData   = detectLiquidityClusters(candles);

    // Module SM-2: Whale Detection
    const whaleData     = detectWhales(futuresData?.depth || {});

    // Module SM-3: Break of Structure (BOS)
    const bosData       = detectBOS(candles, 10);

    // Module SM-4: Institutional Orderflow (Volume Delta)
    const orderflowData = calculateOrderflow(candles, 20);

    // MACD histogram for ML features
    const macdValues    = MACD.calculate({ values: prices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const lastMACDHist  = macdValues[macdValues.length - 1]?.histogram ?? 0;

    // Module SM-5: ML Prediction
    const mlFeatures = buildMLFeatures({
        price: currentPrice,
        rsi: parseFloat(rsiValues[rsiValues.length - 1] ?? 50),
        macdHistogram: lastMACDHist,
        volumeSpike: isVolumeSpike,
        atrPct,
        emaTrend: currentPrice > ema200,
        orderbookImbalance: parseFloat(orderbookData.imbalance || 0),
        liquiditySweep: !!detectLiquiditySweep(candles),
        regime,
        session,
        bosType: bosData.bos,
        whaleDominance: whaleData.dominance,
        deltaRatio: orderflowData.deltaRatio,
        clusterScore: clusterData.score
    });
    const mlPrediction = await getMLPrediction(mlFeatures);

    // ── Spread & Slippage Calculation ──
    let spread = 0;
    if (futuresData?.depth?.asks?.length > 0 && futuresData?.depth?.bids?.length > 0) {
        const bestAsk = futuresData.depth.asks[0][0];
        const bestBid = futuresData.depth.bids[0][0];
        spread = (bestAsk - bestBid) / bestBid;
    }

    // ── STEP 4: DUAL SCORE CALCULATION (Fixes missing SELL signals) ──
    let bullishScore = 0;
    let bearishScore = 0;

    // ── NEW WEIGHTING SYSTEM (User Request) ──
    /**
     * Better weighting:
     * Market Structure → 30
     * Liquidity → 20
     * Volume → 15
     * Momentum → 10
     * SR → 10
     * VWAP → 5
     * Orderbook → 5
     * EMA200 → 5
     */

    // A. Market Structure (25%)
    if (marketStructureData.structure === 'BULLISH') bullishScore += 25;
    else if (marketStructureData.structure === 'BEARISH') bearishScore += 25;

    // B. Liquidity Zones + Clusters (20%)
    if (liqScore > 60) bullishScore += 12;
    else if (liqScore < 40) bearishScore += 12;
    // Cluster proximity bonus (±8)
    if (clusterData.score > 60) bullishScore += 8;
    else if (clusterData.score < 40) bearishScore += 8;

    // C. Volume Flow + Profile + Orderflow Delta (15%)
    if (volumeScore > 65) bullishScore += 10;
    else if (volumeScore < 35) bearishScore += 10;
    if (orderflowData.score > 65) bullishScore += 5;
    else if (orderflowData.score < 35) bearishScore += 5;

    // D. Momentum - RSI & MACD (10%)
    if (momentumScore > 60) bullishScore += 10;
    else if (momentumScore < 40) bearishScore += 10;

    // E. Support / Resistance (10%)
    if (srRating >= 75) bullishScore += 10;
    else if (srRating <= 28) bearishScore += 10;

    // F. Orderbook Imbalance + Whale Detection (10%)
    if (orderbookData.score > 60) bullishScore += 5;
    else if (orderbookData.score < 40) bearishScore += 5;
    if (whaleData.dominance === 'WHALE_BUY') bullishScore += 5;
    else if (whaleData.dominance === 'WHALE_SELL') bearishScore += 5;

    // G. Smart Money: BOS + Order Block (10%)
    if (bosData.bos === 'BULLISH_BOS') bullishScore += 10;
    else if (bosData.bos === 'BEARISH_BOS') bearishScore += 10;
    else if (bosData.bos === 'BULLISH_CHOCH') bullishScore += 5;
    else if (bosData.bos === 'BEARISH_CHOCH') bearishScore += 5;

    // H. VWAP Bias (5%)
    if (vwapData.bias === 'Bullish') bullishScore += 5;
    else bearishScore += 5;

    // I. EMA 200 Trend (5%)
    if (currentPrice > ema200) bullishScore += 5;
    else bearishScore += 5;

    // J. ML Prediction Bonus (up to +8 pts)
    if (mlPrediction && mlPrediction.available) {
        if (mlPrediction.buyProbability > 70) bullishScore += 8;
        else if (mlPrediction.sellProbability > 70) bearishScore += 8;
    }

    // ── SESSION FILTER (BEST UTC: 07:00 - 16:00, WORST: 20:00 - 03:00) ──
    const hour = new Date().getUTCHours();
    const isBestTime = hour >= 7 && hour <= 16;
    const isBadTime = hour >= 20 || hour <= 3;

    let sessionBonus = isBestTime ? 5 : isBadTime ? -15 : 0;

    // Apply session bonus to the dominant side
    if (bullishScore > bearishScore) bullishScore += sessionBonus;
    else if (bearishScore > bullishScore) bearishScore += sessionBonus;

    // Final Probabilities
    const bullishProb = Math.round(Math.min(Math.max(bullishScore, 0), 100));
    const bearishProb = Math.round(Math.min(Math.max(bearishScore, 0), 100));

    // ── STEP 5: Risk & Alignment ──────────────────────────────
    const liquiditySweep = detectLiquiditySweep(candles);
    const orderBlock = detectOrderBlocks(candles);
    const patternData = detectCandlePattern(candles);
    const volumeScore_val = (volumeData.score + volProfile.score) / 2;
    const breakoutProb = calculateBreakoutProbability(candles, volumeScore_val, momentumScore, volScore);

    // ── ADAPTIVE THRESHOLD ──────────────────────────────
    let trendThreshold = 65;
    if (atrPct > 1.2) trendThreshold = 60;
    else if (atrPct < 0.3) trendThreshold = 70;

    // ── SIGNAL DECISION ──
    let finalAction = 'WAIT';
    // Always show the dominant direction score (not flat 50) so scanner is informative
    let technicalScore = Math.max(bullishProb, bearishProb);
    let adjustedProb = technicalScore;

    // ── AI CONFIDENCE BOOST (User Request) ──
    // Blend Tech Score (70%) with ML Confidence (30%) if ML is strong
    if (mlPrediction && mlPrediction.available && mlPrediction.confidence > 60) {
        const mlTargetProb = (bullishProb > bearishProb) ? mlPrediction.buyProbability : mlPrediction.sellProbability;
        
        // Only blend if ML supports the technical direction
        if ((bullishProb > bearishProb && mlPrediction.buyProbability > 55) || 
            (bearishProb > bullishProb && mlPrediction.sellProbability > 55)) {
            adjustedProb = Math.round((technicalScore * 0.7) + (mlTargetProb * 0.3));
        }
    }

    if (bullishProb > bearishProb && adjustedProb >= trendThreshold) {
        finalAction = 'BUY';
    } else if (bearishProb > bullishProb && adjustedProb >= (trendThreshold - 5)) {
        finalAction = 'SELL';
    }

    // ── Trend Strength Filter (ADX) ──
    const adxValues = ADX.calculate({
        high: candles.map(c => c.high),
        low: candles.map(c => c.low),
        close: candles.map(c => c.close),
        period: 14
    });
    const currentADX = adxValues[adxValues.length - 1]?.adx ?? 0;

    // Block non-trending markets unless extremely strong confluence
    if (currentADX < 18 && adjustedProb < 82) {
        finalAction = 'WAIT';
    }

    // ── Trend Strength Detection (STRICT to avoid fake signals) ──
    const trendStrength = Math.abs(bullishProb - bearishProb);
    // Requires clear dominance to avoid fake signals
    if (adjustedProb < 78 && trendStrength < 10) {
        finalAction = 'WAIT';
    }

    // ── Time-Based Avoidance (LATE NY / LOW LIQUIDITY) ──
    if (isBadTime && adjustedProb < 85) {
        finalAction = 'WAIT';
    }


    // ── ADVANCED ACCURACY FILTERS ──

    // 1. RSI Exhaustion (Avoid buying tops / selling bottoms)
    const rsiNum = parseFloat(rsiValues[rsiValues.length - 1] ?? 50);
    if (adjustedProb < 82) { // Only elite momentum can bypass
        if (finalAction === 'BUY' && rsiNum > 70) finalAction = 'WAIT';   // Overbought trap
        if (finalAction === 'SELL' && rsiNum < 30) finalAction = 'WAIT';  // Oversold trap
    }

    // 1b. Choppy / Ranging Market Filter
    // In flat markets, require a much stronger confluence (>= 78) to avoid fake-outs
    if (regime === 'RANGING' && adjustedProb < 78) {
        finalAction = 'WAIT';
    }

    // 1c. EMA 200 Trap Filter (Avoid getting rejected at major moving average)
    if (adjustedProb < 80) {
        const distEMA = Math.abs(currentPrice - ema200) / ema200;
        // If price is within 0.3% of EMA200
        if (distEMA < 0.003) {
            if (finalAction === 'BUY' && currentPrice <= ema200) finalAction = 'WAIT'; // Buying right under resistance
            if (finalAction === 'SELL' && currentPrice >= ema200) finalAction = 'WAIT'; // Shorting right above support
        }
    }

    // 2. Liquidity Pool Filter (Avoid Sweep Traps) - Stricter
    if (adjustedProb < 75) {
        if (eqHL.eqh && finalAction === 'BUY') finalAction = 'WAIT';
        if (eqHL.eql && finalAction === 'SELL') finalAction = 'WAIT';
    }

    // 3. Orderbook Spread Filter
    if (spread > 0.003) finalAction = 'WAIT';

    // 4. Volume & Score Confirmation
    // For Forex, we relax this volume check, but still require decent score
    const isForex = symbol.includes("/");
    if (!isVolumeSpike && adjustedProb < (isForex ? 65 : 70) && finalAction !== 'WAIT') {
        finalAction = 'WAIT';
    }

    // 5. Multi-Candle Confirmation (Last 3)
    const last3 = candles.slice(-3);
    const bullishCandles = last3.filter(c => c.close > c.open).length;
    const bearishCandles = last3.filter(c => c.close < c.open).length;

    // STRICT: Require 2/3 instead of 1/3 for scalping. 
    // High probability signals (>= 75) can skip candle confirmation.
    if (adjustedProb < 75) {
        if (finalAction === 'BUY' && (bullishCandles < 2)) finalAction = 'WAIT';
        if (finalAction === 'SELL' && (bearishCandles < 2)) finalAction = 'WAIT';
    }

    // ── CONFLUENCE FACTORS ──
    const factors = [];
    if (marketStructureData.structure === 'BULLISH') factors.push('Bullish Trend Alignment');
    if (marketStructureData.structure === 'BEARISH') factors.push('Bearish Trend Alignment');
    if (srRating >= 75) factors.push('Support Bounce');
    if (srRating <= 28) factors.push('Resistance Rejection');
    if (isVolumeSpike) factors.push('Volume Spike');
    if (volumeData.isHighDelta) factors.push(`Volume Delta (${volumeData.deltaPct})`);
    if (orderbookData.score > 60) factors.push('Orderbook Bids+');
    if (orderbookData.score < 40) factors.push('Orderbook Asks+');
    if (liquiditySweep) factors.push('Liquidity Sweep');
    if (finalAction !== 'WAIT' && (currentPrice > ema200 && finalAction === 'BUY')) factors.push('EMA 200 Support');
    if (finalAction !== 'WAIT' && (currentPrice < ema200 && finalAction === 'SELL')) factors.push('EMA 200 Resistance');
    // Smart Money confluence tags
    if (bosData.bos === 'BULLISH_BOS') factors.push('🔵 Bullish BOS');
    if (bosData.bos === 'BEARISH_BOS') factors.push('🔴 Bearish BOS');
    if (whaleData.dominance === 'WHALE_BUY')  factors.push('🐳 Whale Buy Wall');
    if (whaleData.dominance === 'WHALE_SELL') factors.push('🐳 Whale Sell Wall');
    if (orderflowData.bias.includes('BUY'))   factors.push(`📊 Buy Delta (${(orderflowData.deltaRatio * 100).toFixed(0)}%)`);
    if (orderflowData.bias.includes('SELL'))  factors.push(`📊 Sell Delta (${(orderflowData.deltaRatio * 100).toFixed(0)}%)`);
    if (clusterData.clusterCount > 0) factors.push(`💧 Liquidity Pool (${clusterData.clusterCount} clusters)`);
    if (mlPrediction?.available && mlPrediction.buyProbability > 70)  factors.push(`🤖 ML Buy (${mlPrediction.buyProbability}%)`);
    if (mlPrediction?.available && mlPrediction.sellProbability > 70) factors.push(`🤖 ML Sell (${mlPrediction.sellProbability}%)`);

    const isRegimeAligned = (finalAction === 'BUY' && regime.includes('BULLISH')) ||
        (finalAction === 'SELL' && regime.includes('BEARISH')) || (regime === 'RANGING');

    // STRICT: Confluence counts.
    if (finalAction !== 'WAIT' && adjustedProb < 70 && (factors.length < 2 || atrPct < 0.015)) {
        finalAction = 'WAIT';
    }

    const lastCandle = candles[candles.length - 1];
    const bodySize = Math.abs(lastCandle.close - lastCandle.open) || 0.00000001; // prevent div by zero
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

    // STRICT: Wick rejection threshold.
    if (adjustedProb < 75) {
        if (finalAction === 'BUY' && upperWick > bodySize * 2.0) finalAction = 'WAIT'; // Rejected from above
        else if (finalAction === 'SELL' && lowerWick > bodySize * 2.5) finalAction = 'WAIT'; // Rejected from below
    }

    const isTrendSignal = adjustedProb >= trendThreshold || adjustedProb <= (100 - trendThreshold);
    const isBreakoutSignal = (adjustedProb > 60 || adjustedProb < 40) && isVolumeSpike && liquiditySweep;

    const totalBias = bullishProb > bearishProb ? 'Bullish' : (bearishProb > bullishProb ? 'Bearish' : 'Neutral');

    let strengthLabel = 'Normal';
    if (adjustedProb >= 85) strengthLabel = 'Institutional';
    else if (adjustedProb >= 75) strengthLabel = 'Strong';
    else if (adjustedProb < 65) strengthLabel = 'Weak';

    // ── RISK MODEL (TP/SL) ───────────────────────────
    const riskAmount = currentATR * riskConfig.atrMultiplierSL;
    let slVal = finalAction === 'BUY' ? currentPrice - riskAmount : currentPrice + riskAmount;

    // Targets based on RR
    let tp1 = finalAction === 'BUY' ? currentPrice + (riskAmount * riskConfig.target1RR) : currentPrice - (riskAmount * riskConfig.target1RR);
    let tp2 = finalAction === 'BUY' ? currentPrice + (riskAmount * riskConfig.target2RR) : currentPrice - (riskAmount * riskConfig.target2RR);

    let targetType = 'Institutional RR';

    if (finalAction === 'BUY') {
        if (volProfile.vah > currentPrice && volProfile.vah < tp1) { tp1 = volProfile.vah; targetType = 'Volume VAH'; }
    } else if (finalAction === 'SELL') {
        if (volProfile.val < currentPrice && volProfile.val > tp1) { tp1 = volProfile.val; targetType = 'Volume VAL'; }
    }

    const currentRSI = (rsiValues[rsiValues.length - 1] ?? 50).toFixed(1);

    // Calculate dynamic Risk Reward ratio for the selected TP1
    const actualRisk = Math.abs(currentPrice - slVal);
    const actualReward = Math.abs(tp1 - currentPrice);
    const rrRatio = (actualReward / actualRisk).toFixed(1);

    // Dynamic Expiry based on timeframe
    let expiresInMs = riskConfig.scalpingExpiryMs;
    if (timeframe === '1h') expiresInMs = riskConfig.intradayExpiryMs;
    if (timeframe === '4h') expiresInMs = riskConfig.swingExpiryMs;

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
        riskReward: `1:${rrRatio}`,
        currentRSI,
        isVolumeSpike,
        factors,
        trend: marketStructureScore > 60 ? 'Bullish' : marketStructureScore < 40 ? 'Bearish' : 'Neutral',
        patterns: patternData.type,
        timestamp: Date.now(),
        expiresAt: Date.now() + expiresInMs,
        isRegimeAligned,
        bias: totalBias,
        bullishScore,
        bearishScore,
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
            bullishScore: Math.round(bullishScore),
            bearishScore: Math.round(bearishScore),
            futures: Math.round(futuresScore),
            // Smart Money scores
            smartMoneyBOS:      Math.round(bosData.score),
            liquidityCluster:   Math.round(clusterData.score),
            whaleDetection:     Math.round(whaleData.score),
            orderflow:          Math.round(orderflowData.score),
            mlPrediction:       mlPrediction?.confidence ?? 50
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
        },
        smartMoney: {
            bos:            bosData.bos,
            bosDetail:      bosData.detail,
            swingHigh:      bosData.swingHigh,
            swingLow:       bosData.swingLow,
            liquidityClusters: clusterData.clusters.slice(0, 5),
            nearestBidPool: clusterData.nearestBid,
            nearestAskPool: clusterData.nearestAsk,
            whales: {
                dominance:        whaleData.dominance,
                whaleBuyWalls:    whaleData.whaleBuyWall,
                whaleSellWalls:   whaleData.whaleSellWall,
                topBidWall:       whaleData.topBidWall,
                topAskWall:       whaleData.topAskWall
            },
            orderflow: {
                delta:         orderflowData.delta,
                deltaRatio:    orderflowData.deltaRatio,
                bias:          orderflowData.bias,
                isAccelerating: orderflowData.isAccelerating,
                buyVol:        orderflowData.buyVol,
                sellVol:       orderflowData.sellVol
            },
            ml: mlPrediction
        }
    };
}
