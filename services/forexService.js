import axios from "axios";
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.FOREX_API_KEY;

const intervalMap = {
    "5m": "5min",
    "15m": "15min",
    "1h": "1h"
};

/**
 * Fetch Forex/Stock candle data from Twelve Data
 * @param {string} symbol - e.g. "EUR/USD"
 * @param {string} timeframe - "5m", "15m", "1h"
 * @returns {Array} Array of candle objects
 */
export async function getForexCandles(symbol, timeframe, retries = 2) {
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
                    // If it's a rate limit error, don't retry, just wait
                    if (res.data.message?.includes('API key')) {
                        console.error(`[ForexService] API Key Error for ${symbol}: ${res.data.message}`);
                        return [];
                    }
                    console.error(`[ForexService] Data Error for ${symbol}: ${res.data.message}`);
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
