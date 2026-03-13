/**
 * ═══════════════════════════════════════════════════════════════
 * SMART MONEY & ADVANCED ANALYSIS MODULE
 * ═══════════════════════════════════════════════════════════════
 *
 * Implements:
 *   1. Liquidity Heatmap / Cluster Detection
 *   2. Whale Order Detection
 *   3. Break of Structure (BOS) — Smart Money Footprint
 *   4. Institutional Orderflow (Volume Delta Model)
 *   5. ML Prediction Client (Flask / Python API bridge)
 */

import axios from 'axios';
import { nodeMLService } from '../services/nodeMLService.js';

// Initialize Node ML Service (loads model if exists)
nodeMLService.loadModels();


// ═══════════════════════════════════════════════════════════════
// 1. LIQUIDITY HEATMAP — Cluster Detection
// ═══════════════════════════════════════════════════════════════

/**
 * detectLiquidityClusters
 *
 * Scans swing highs & lows for price levels touched ≥ minTouches times.
 * These are "liquidity magnets" — institutional orders sit here.
 *
 * @param {Array} candles
 * @param {number} minTouches  — how many candles must share the level
 * @param {number} tolerance   — price rounding precision (0.01 = 1 cent bucket)
 * @returns {{ clusters: Array, nearestBid: number|null, nearestAsk: number|null, score: number }}
 */
export function detectLiquidityClusters(candles, minTouches = 3, tolerance = 0.01) {
    if (!candles || candles.length < 20) {
        return { clusters: [], nearestBid: null, nearestAsk: null, score: 50 };
    }

    const highMap = {};
    const lowMap = {};

    candles.forEach(c => {
        const highKey = (Math.round(c.high / tolerance) * tolerance).toFixed(8);
        const lowKey  = (Math.round(c.low  / tolerance) * tolerance).toFixed(8);

        highMap[highKey] = (highMap[highKey] || 0) + 1;
        lowMap[lowKey]   = (lowMap[lowKey]   || 0) + 1;
    });

    // Build cluster list with type label
    const clusters = [];

    Object.entries(highMap)
        .filter(([, count]) => count >= minTouches)
        .forEach(([price, count]) => clusters.push({
            price: Number(price),
            count,
            type: 'resistance_pool',
            strength: count >= 6 ? 'STRONG' : 'MODERATE'
        }));

    Object.entries(lowMap)
        .filter(([, count]) => count >= minTouches)
        .forEach(([price, count]) => clusters.push({
            price: Number(price),
            count,
            type: 'support_pool',
            strength: count >= 6 ? 'STRONG' : 'MODERATE'
        }));

    // Sort by strength (count) desc
    clusters.sort((a, b) => b.count - a.count);

    const currentPrice = candles[candles.length - 1].close;

    // Find nearest bid / ask pools relative to current price
    const bidPools = clusters.filter(c => c.price < currentPrice && c.type === 'support_pool');
    const askPools = clusters.filter(c => c.price > currentPrice && c.type === 'resistance_pool');

    const nearestBid = bidPools.length > 0
        ? bidPools.reduce((a, b) => Math.abs(a.price - currentPrice) < Math.abs(b.price - currentPrice) ? a : b)
        : null;
    const nearestAsk = askPools.length > 0
        ? askPools.reduce((a, b) => Math.abs(a.price - currentPrice) < Math.abs(b.price - currentPrice) ? a : b)
        : null;

    // Score: if price is near a strong support pool → bullish bonus
    let score = 50;
    if (nearestBid) {
        const distBid = Math.abs(currentPrice - nearestBid.price) / currentPrice;
        if (distBid < 0.002) score += nearestBid.strength === 'STRONG' ? 18 : 10;
    }
    if (nearestAsk) {
        const distAsk = Math.abs(currentPrice - nearestAsk.price) / currentPrice;
        if (distAsk < 0.002) score -= nearestAsk.strength === 'STRONG' ? 18 : 10;
    }

    return {
        clusters: clusters.slice(0, 10), // Top 10 most significant
        nearestBid: nearestBid ? nearestBid.price : null,
        nearestAsk: nearestAsk ? nearestAsk.price : null,
        clusterCount: clusters.length,
        score: Math.min(Math.max(Math.round(score), 0), 100)
    };
}

// ═══════════════════════════════════════════════════════════════
// 2. WHALE ORDER DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * detectWhales
 *
 * Scans the top N orderbook levels for unusually large orders.
 * A "whale" order is defined as size > whaleThreshold.
 *
 * @param {Object} orderbook  — { bids: [[price, size], ...], asks: [[price, size], ...] }
 * @param {number} whaleThreshold — minimum size to qualify as whale
 * @returns {{ whaleBuyWall: number, whaleSellWall: number, dominance: string, score: number, details: Object }}
 */
export function detectWhales(orderbook, whaleThreshold = null) {
    if (!orderbook || !orderbook.bids || !orderbook.asks) {
        return { whaleBuyWall: 0, whaleSellWall: 0, dominance: 'NEUTRAL', score: 50, details: {} };
    }

    // Auto-calibrate threshold based on median order size (adaptive to any asset class)
    if (!whaleThreshold) {
        const allSizes = [
            ...orderbook.bids.slice(0, 50).map(b => b[1]),
            ...orderbook.asks.slice(0, 50).map(a => a[1])
        ].sort((a, b) => a - b);
        const median = allSizes[Math.floor(allSizes.length / 2)] || 1;
        whaleThreshold = median * 10; // 10× median = whale
    }

    const whaleBids = orderbook.bids.filter(b => b[1] >= whaleThreshold);
    const whaleAsks = orderbook.asks.filter(a => a[1] >= whaleThreshold);

    const totalWhaleBidSize = whaleBids.reduce((s, b) => s + b[1], 0);
    const totalWhaleAskSize = whaleAsks.reduce((s, a) => s + a[1], 0);

    // Top whale levels for display
    const topBidWall = whaleBids.reduce((max, b) => b[1] > max.size ? { price: b[0], size: b[1] } : max, { price: 0, size: 0 });
    const topAskWall = whaleAsks.reduce((max, a) => a[1] > max.size ? { price: a[0], size: a[1] } : max, { price: 0, size: 0 });

    // Dominance
    let dominance = 'NEUTRAL';
    let score = 50;

    if (totalWhaleBidSize > totalWhaleAskSize * 1.5) {
        dominance = 'WHALE_BUY';
        score = 80;
    } else if (totalWhaleAskSize > totalWhaleBidSize * 1.5) {
        dominance = 'WHALE_SELL';
        score = 20;
    } else if (whaleBids.length > 0 || whaleAsks.length > 0) {
        dominance = 'WHALE_BALANCED';
        score = 50;
    }

    return {
        whaleBuyWall: whaleBids.length,
        whaleSellWall: whaleAsks.length,
        totalWhaleBidSize: totalWhaleBidSize.toFixed(2),
        totalWhaleAskSize: totalWhaleAskSize.toFixed(2),
        topBidWall,
        topAskWall,
        dominance,
        score,
        threshold: whaleThreshold.toFixed(4)
    };
}

// ═══════════════════════════════════════════════════════════════
// 3. BREAK OF STRUCTURE (BOS) — Smart Money Footprint
// ═══════════════════════════════════════════════════════════════

/**
 * detectBOS
 *
 * Detects when price breaks above the most recent swing high (Bullish BOS)
 * or below the most recent swing low (Bearish BOS).
 *
 * Smart Money Entry Pattern:
 *   Liquidity Sweep → BOS → Pullback → Entry
 *
 * @param {Array} candles
 * @param {number} lookback  — how many candles to look back for the swing
 * @returns {{ bos: string|null, swingHigh: number, swingLow: number, score: number, detail: string }}
 */
export function detectBOS(candles, lookback = 10) {
    if (!candles || candles.length < lookback + 2) {
        return { bos: null, swingHigh: 0, swingLow: 0, score: 50, detail: 'Insufficient data' };
    }

    const recent  = candles.slice(-(lookback + 1), -1); // lookback window (excluding last)
    const last    = candles[candles.length - 1];
    const prev    = candles[candles.length - 2];

    const swingHigh = Math.max(...recent.map(c => c.high));
    const swingLow  = Math.min(...recent.map(c => c.low));

    let bos = null;
    let score = 50;
    let detail = 'No BOS';

    // Bullish BOS: last candle closes ABOVE the swing high
    if (last.close > swingHigh && prev.close <= swingHigh) {
        bos = 'BULLISH_BOS';
        score = 82;
        detail = `Bullish BOS: closed above ${swingHigh.toFixed(4)}`;
    }
    // Bearish BOS: last candle closes BELOW the swing low
    else if (last.close < swingLow && prev.close >= swingLow) {
        bos = 'BEARISH_BOS';
        score = 18;
        detail = `Bearish BOS: closed below ${swingLow.toFixed(4)}`;
    }
    // Change of Character (CHoCH) — early warning (not a full BOS yet)
    else if (last.high > swingHigh && last.close < swingHigh) {
        bos = 'BULLISH_CHOCH';
        score = 65;
        detail = `Bullish CHoCH (fake-out risk)`;
    } else if (last.low < swingLow && last.close > swingLow) {
        bos = 'BEARISH_CHOCH';
        score = 35;
        detail = `Bearish CHoCH (fake-out risk)`;
    }

    return { bos, swingHigh, swingLow, score, detail };
}

// ═══════════════════════════════════════════════════════════════
// 4. INSTITUTIONAL ORDERFLOW — Volume Delta Model
// ═══════════════════════════════════════════════════════════════

/**
 * calculateOrderflow
 *
 * Professional delta volume analysis.
 * Aggressive buyers  = candles where close > open (buying pressure).
 * Aggressive sellers = candles where close < open (selling pressure).
 *
 * Delta = buyVolume - sellVolume over last N candles
 *
 * @param {Array} candles
 * @param {number} period — lookback period (default 20)
 * @returns {{ delta: number, deltaRatio: number, bias: string, score: number, details: Object }}
 */
export function calculateOrderflow(candles, period = 20) {
    if (!candles || candles.length < period) {
        return { delta: 0, deltaRatio: 0, bias: 'NEUTRAL', score: 50, details: {} };
    }

    const window = candles.slice(-period);

    let buyVol  = 0;
    let sellVol = 0;
    let buyCount = 0;
    let sellCount = 0;

    window.forEach(c => {
        if (c.close > c.open) {
            buyVol  += c.volume;
            buyCount++;
        } else if (c.close < c.open) {
            sellVol += c.volume;
            sellCount++;
        } else {
            // Doji — split volume equally
            buyVol  += c.volume / 2;
            sellVol += c.volume / 2;
        }
    });

    const totalVol = buyVol + sellVol;
    const delta = buyVol - sellVol;
    const deltaRatio = totalVol > 0 ? delta / totalVol : 0; // -1 to +1

    // Cumulative delta trend (last 5 vs last 10)
    const shortWindow  = candles.slice(-5);
    const longWindow   = candles.slice(-10);
    const shortDelta   = shortWindow.reduce((s, c) => s + (c.close > c.open ? c.volume : -c.volume), 0);
    const longDelta    = longWindow.reduce((s, c) => s + (c.close > c.open ? c.volume : -c.volume), 0);
    const isAccelerating = shortDelta > 0 && longDelta > 0 && shortDelta / (shortWindow.length) > longDelta / (longWindow.length);
    const isDecelerating = shortDelta < 0 && longDelta < 0;

    // Score model
    let score = 50 + deltaRatio * 35; // Base score from delta ratio

    // Bonus for acceleration / deceleration
    if (isAccelerating) score += 8;
    if (isDecelerating) score -= 8;

    // Determine bias label
    let bias = 'NEUTRAL';
    if (deltaRatio > 0.2)  bias = 'STRONG_BUY_PRESSURE';
    else if (deltaRatio > 0.1)  bias = 'BUY_PRESSURE';
    else if (deltaRatio < -0.2) bias = 'STRONG_SELL_PRESSURE';
    else if (deltaRatio < -0.1) bias = 'SELL_PRESSURE';

    return {
        delta: Math.round(delta),
        deltaRatio: parseFloat(deltaRatio.toFixed(4)),
        buyVol: Math.round(buyVol),
        sellVol: Math.round(sellVol),
        buyCount,
        sellCount,
        isAccelerating,
        isDecelerating,
        bias,
        score: Math.min(Math.max(Math.round(score), 0), 100),
        shortDelta: Math.round(shortDelta),
        longDelta: Math.round(longDelta)
    };
}

// ═══════════════════════════════════════════════════════════════
// 5. ML PREDICTION CLIENT (Python Flask API Bridge)
// ═══════════════════════════════════════════════════════════════

// Default ML API endpoint — configure via .env
const ML_API_URL = process.env.ML_API_URL || 'http://localhost:5001/predict';
const ML_ENGINE  = process.env.ML_ENGINE  || 'python'; // 'python' or 'node'
const ML_TIMEOUT_MS = 3000; // 3 seconds max

/**
 * getMLPrediction
 *
 * Sends feature vector to Python ML API and retrieves prediction.
 * Fails gracefully — if API is down, returns null (system continues rule-based).
 *
 * Feature vector includes:
 *   price, rsi, macd, volumeSpike, atr, emaTrend, orderbookImbalance,
 *   liquiditySweep, regime (encoded), session (encoded)
 *
 * @param {Object} features
 * @returns {{ buyProbability: number, sellProbability: number, confidence: number } | null}
 */
export async function getMLPrediction(features) {
    // ── Local Node ML Logic ─────────────────────────────────
    if (ML_ENGINE === 'node') {
        const result = await nodeMLService.predict(features);
        if (result) return result;
        // Fallback to python if node fails/not loaded
    }

    // ── Python ML Logic (Flask API) ──────────────────────────
    try {
        const response = await axios.post(ML_API_URL, { features }, {
            timeout: ML_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' }
        });

        const data = response.data;

        if (!data || typeof data.buy_probability !== 'number') {
            return null;
        }

        return {
            buyProbability:  parseFloat((data.buy_probability  * 100).toFixed(1)),
            sellProbability: parseFloat((data.sell_probability * 100).toFixed(1)),
            confidence:      parseFloat(((Math.max(data.buy_probability, data.sell_probability)) * 100).toFixed(1)),
            modelVersion:    data.model_version || 'unknown',
            available: true,
            source: 'python_api'
        };

    } catch {
        // ML API not available — return stub so system stays functional
        return {
            buyProbability: 50,
            sellProbability: 50,
            confidence: 50,
            available: false
        };
    }
}

/**
 * buildMLFeatures
 *
 * Constructs the feature vector from the analysis result.
 * Called by runAIAnalysis before querying the ML API.
 *
 * @param {Object} params — destructured from technical analysis results
 * @returns {Object} — feature vector ready for ML API
 */
export function buildMLFeatures({
    price,
    rsi,
    macdHistogram,
    volumeSpike,
    atrPct,
    emaTrend,          // 1 = price above EMA200, 0 = below
    orderbookImbalance,// raw float -1 to +1
    liquiditySweep,    // 1 = sweep detected, 0 = none
    regime,            // 'BULLISH TREND' | 'BEARISH TREND' | 'RANGING' | 'VOLATILE'
    session,           // 'LONDON_OPEN' | 'NY_OVERLAP' | 'NEW_YORK' | 'ASIA' | 'LATE_NY'
    bosType,           // 'BULLISH_BOS' | 'BEARISH_BOS' | null
    whaleDominance,    // 'WHALE_BUY' | 'WHALE_SELL' | 'NEUTRAL'
    deltaRatio,        // orderflow delta ratio -1 to +1
    clusterScore       // liquidity cluster proximity score 0-100
}) {
    // Encode categorical features numerically
    const regimeMap = { 'BULLISH TREND': 1, 'BEARISH TREND': -1, 'RANGING': 0, 'VOLATILE': 0.5 };
    const sessionMap = { 'LONDON_OPEN': 1, 'NY_OVERLAP': 1, 'NEW_YORK': 0.7, 'ASIA': 0.3, 'LATE_NY': 0.1, 'DORMANT': 0 };
    const bosMap = { 'BULLISH_BOS': 1, 'BULLISH_CHOCH': 0.5, 'BEARISH_CHOCH': -0.5, 'BEARISH_BOS': -1 };
    const whaleMap = { 'WHALE_BUY': 1, 'NEUTRAL': 0, 'WHALE_BALANCED': 0, 'WHALE_SELL': -1 };

    return {
        price,
        rsi:               parseFloat((rsi || 50).toFixed(2)),
        macd_histogram:    parseFloat((macdHistogram || 0).toFixed(6)),
        volume_spike:      volumeSpike ? 1 : 0,
        atr_pct:           parseFloat((atrPct || 0).toFixed(4)),
        ema_trend:         emaTrend ? 1 : 0,
        orderbook_imbalance: parseFloat((orderbookImbalance || 0).toFixed(4)),
        liquidity_sweep:   liquiditySweep ? 1 : 0,
        regime:            regimeMap[regime] ?? 0,
        session:           sessionMap[session] ?? 0.5,
        bos:               bosMap[bosType] ?? 0,
        whale_dominance:   whaleMap[whaleDominance] ?? 0,
        delta_ratio:       parseFloat((deltaRatio || 0).toFixed(4)),
        cluster_score:     parseFloat(((clusterScore || 50) / 100).toFixed(4))
    };
}
