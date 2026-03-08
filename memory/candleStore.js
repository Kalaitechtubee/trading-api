/**
 * TREADING AI — In-Memory Candle Store
 * Caches candle history to avoid repetitive full-history API calls.
 */

const candleCache = new Map();
const MAX_CANDLES = 500;

/**
 * Get cached candles for a symbol and timeframe
 * @param {string} symbol 
 * @param {string} timeframe 
 * @returns {Array|null}
 */
export function getCachedCandles(symbol, timeframe) {
    return candleCache.get(`${symbol}_${timeframe}`) || null;
}

/**
 * Update or initialize candles in cache
 * @param {string} symbol 
 * @param {string} timeframe 
 * @param {Array} candles 
 */
export function updateCandles(symbol, timeframe, candles) {
    if (!candles || candles.length === 0) return;

    const key = `${symbol}_${timeframe}`;
    const existing = candleCache.get(key);

    if (!existing) {
        candleCache.set(key, candles.slice(-MAX_CANDLES));
        return;
    }

    // Smart Merge: only add new candles
    const lastExistingTime = existing[existing.length - 1].time;
    const newCandles = candles.filter(c => c.time > lastExistingTime);

    if (newCandles.length > 0) {
        const updated = [...existing, ...newCandles].slice(-MAX_CANDLES);
        candleCache.set(key, updated);
    }
}

/**
 * Clear cache (e.g. on server restart or symbol change)
 */
export function clearCandleCache() {
    candleCache.clear();
}
