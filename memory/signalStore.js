/**
 * TREADING AI — In-Memory Signal Store
 * Stores last 200 signals in memory (no database required for v1)
 */

const signals = [];
const MAX_SIGNALS = 200;

/**
 * Add a new signal to the store (most recent first)
 * @param {Object} signal
 */
export function addSignal(signal) {
    // Unique key: symbol_timeframe
    const key = `${signal.symbol}_${signal.timeframe}`;

    // Update existing signal for this pair/tf if it exists
    const idx = signals.findIndex(s => `${s.symbol}_${s.timeframe}` === key);
    if (idx !== -1) {
        signals.splice(idx, 1); // Remove old signal
    }

    signals.unshift(signal);
    if (signals.length > MAX_SIGNALS) {
        signals.pop();
    }
}

/**
 * Get all stored signals (can include expired)
 * @returns {Array}
 */
export function getSignals() {
    return signals;
}

/**
 * Get active (non-expired) signals
 * @returns {Array}
 */
export function getActiveSignals() {
    const now = Date.now();
    return signals.filter(s => s.expiresAt > now);
}

/**
 * Get signals filtered by optional criteria, excluding expired by default
 * @param {{ symbol?: string, action?: string, minScore?: number, includeExpired?: boolean }} filters
 * @returns {Array}
 */
export function getFilteredSignals({ symbol, action, minScore, includeExpired = false } = {}) {
    const now = Date.now();
    return signals.filter(s => {
        if (!includeExpired && s.expiresAt < now) return false;
        if (symbol && s.symbol !== symbol.toUpperCase()) return false;
        if (action && s.action !== action.toUpperCase()) return false;
        if (minScore && s.score < minScore) return false;
        return true;
    });
}

/**
 * Get top N non-expired signals by score
 * @param {number} n
 * @returns {Array}
 */
export function getTopSignals(n = 10) {
    const now = Date.now();
    return signals
        .filter(s => s.expiresAt > now && s.action !== 'WAIT')
        .sort((a, b) => b.score - a.score)
        .slice(0, n);
}

/**
 * Get scanner status summary
 * @returns {Object}
 */
export function getScannerStatus() {
    const now = Date.now();
    const active = signals.filter(s => s.expiresAt > now);
    return {
        totalSignals: signals.length,
        activeSignals: active.length,
        lastScanTime: signals.length > 0 ? signals[0].timestamp : null,
        buySignals: active.filter(s => s.action === 'BUY').length,
        sellSignals: active.filter(s => s.action === 'SELL').length,
        highConfidence: active.filter(s => s.score >= 70).length
    };
}
