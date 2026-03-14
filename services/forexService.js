import axios from "axios";

// ── Hardcoded Config (no .env needed) ────────────────────────
const API_KEY = '74f94a276d4745c7a0d0525a9d016574';

const intervalMap = {
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "4h": "4h"
};

// ── Circuit Breaker — Daily Limit Protection ─────────────────
// Once the daily API limit is hit, we stop all further Forex calls
// until the next calendar day (credits reset at midnight UTC).
let forexDisabled = false;
let forexDisabledAt = null;

function checkDailyReset() {
    if (!forexDisabledAt) return;
    const now = new Date();
    const disabledDay = new Date(forexDisabledAt);
    // Reset if we've crossed midnight UTC
    if (now.getUTCDate() !== disabledDay.getUTCDate() ||
        now.getUTCMonth() !== disabledDay.getUTCMonth()) {
        forexDisabled = false;
        forexDisabledAt = null;
        console.log('[ForexService] ✅ Daily API credits reset. Forex scanning re-enabled.');
    }
}

/**
 * Returns whether the forex circuit breaker is currently active.
 * Used by marketScanner.js to skip forex symbols entirely when disabled.
 */
export function isForexDisabled() {
    checkDailyReset();
    return forexDisabled;
}

/**
 * Fetch Forex/Stock candle data from Twelve Data
 * @param {string} symbol - e.g. "EUR/USD"
 * @param {string} timeframe - "5m", "15m", "1h"
 * @returns {Array} Array of candle objects
 */
export async function getForexCandles(symbol, timeframe, retries = 2) {
    // ── Circuit Breaker Check ─────────────────────────────────
    checkDailyReset();
    if (forexDisabled) return [];

    if (!API_KEY) {
        console.warn("[ForexService] FOREX_API_KEY not found. Skipping Forex scan.");
        return [];
    }

    const maxRetries = retries;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            const url =
                `https://api.twelvedata.com/time_series?symbol=${symbol}` +
                `&interval=${intervalMap[timeframe]}` +
                `&outputsize=300&apikey=${API_KEY}`;

            const res = await axios.get(url, { timeout: 12000 });

            if (!res.data || !res.data.values) {
                if (res.data && res.data.status === 'error') {
                    const msg = res.data.message || '';

                    // ── Daily Credit Limit Hit → Trip the Circuit Breaker ──
                    if (msg.includes('API credits') || msg.includes('out of API credits')) {
                        if (!forexDisabled) {
                            forexDisabled = true;
                            forexDisabledAt = new Date();
                            console.warn(`[ForexService] ⚠️  Daily API credit limit reached. Forex scanning DISABLED until UTC midnight.`);
                            console.warn(`[ForexService] 💡 Tip: Upgrade Twelve Data plan or reduce scan frequency.`);
                        }
                        return [];
                    }

                    // ── Invalid API Key ────────────────────────────────────
                    if (msg.includes('API key')) {
                        console.error(`[ForexService] ❌ API Key Error for ${symbol}: ${msg}`);
                        return [];
                    }

                    console.error(`[ForexService] Data Error for ${symbol}: ${msg}`);
                }
                return [];
            }

            return res.data.values.map(c => ({
                time: new Date(c.datetime).getTime() / 1000,
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume || 0)
            })).reverse();

        } catch (err) {
            attempt++;
            const isNetworkError = err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';

            if (isNetworkError && attempt <= maxRetries) {
                const wait = attempt * 2000;
                console.warn(`[ForexService] Network/DNS error for ${symbol} (Attempt ${attempt}/${maxRetries}). Retrying in ${wait}ms...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }

            console.error(`[ForexService] Fatal Error fetching ${symbol}:`, err.message);
            return [];
        }
    }
    return [];
}
