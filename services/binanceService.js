/**
 * TREADING AI — Binance Data Service (Backend)
 * Fetches OHLCV candles + futures data directly from Binance REST API
 */

import axios from 'axios';

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';

// Stablecoins to ignore for scanning
const STABLECOINS = ['USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'EUR', 'GBP', 'BUSD', 'AEUR', 'ZAR', 'USDS'];

/**
 * Fetch OHLCV candle data from Binance spot
 * @param {string} symbol  e.g. "BTCUSDT"
 * @param {string} interval e.g. "15m"
 * @param {number} limit    Number of candles (max 1000)
 * @returns {Array<{time,open,high,low,close,volume}>}
 */
export async function getCandles(symbol, interval = '15m', limit = 300) {
    try {
        const res = await axios.get(`${BINANCE_BASE}/klines`, {
            params: { symbol, interval, limit },
            timeout: 10000
        });

        return res.data.map(k => ({
            time: k[0] / 1000,          // Unix seconds
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5])
        }));
    } catch (err) {
        console.error(`[BinanceService] Failed to fetch ${symbol}:`, err.message);
        return [];
    }
}

/**
 * Fetch funding rate + open interest for futures symbols
 * @param {string} symbol
 * @returns {{ fundingRate: string, openInterest: number }}
 */
export async function getFuturesData(symbol) {
    try {
        const [fundingRes, oiRes] = await Promise.all([
            axios.get(`${BINANCE_FUTURES_BASE}/premiumIndex`, { params: { symbol }, timeout: 5000 }),
            axios.get(`${BINANCE_FUTURES_BASE}/openInterest`, { params: { symbol }, timeout: 5000 })
        ]);

        return {
            fundingRate: (parseFloat(fundingRes.data.lastFundingRate) * 100).toFixed(4),
            openInterest: parseFloat(oiRes.data.openInterest),
            timestamp: Date.now(),
            hasFutures: true
        };
    } catch (err) {
        // Silently return null-state for spot-only pairs
        return { fundingRate: '0.0000', openInterest: 0, hasFutures: false };
    }
}

/**
 * Fetch Orderbook Depth
 * @param {string} symbol
 * @param {number} limit
 * @returns {Object} { bids: [price, qty][], asks: [price, qty][] }
 */
export async function getOrderbook(symbol, limit = 50) {
    try {
        const res = await axios.get(`${BINANCE_BASE}/depth`, {
            params: { symbol, limit },
            timeout: 5000
        });
        return {
            bids: res.data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: res.data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])])
        };
    } catch (err) {
        return { bids: [], asks: [] };
    }
}

/**
 * Fetch top volume USDT pairs from Binance
 * @param {number} limit
 * @returns {string[]}
 */
export async function getTopVolumeSymbols(limit = 50) {
    try {
        const res = await axios.get(`${BINANCE_BASE}/ticker/24hr`, { timeout: 10000 });
        return res.data
            .filter(t => {
                const isUSDT = t.symbol.endsWith('USDT');
                const isStable = STABLECOINS.some(s => t.symbol.includes(s));
                return isUSDT && !isStable;
            })
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, limit)
            .map(t => t.symbol);
    } catch (err) {
        console.error('[BinanceService] Failed to fetch top volume symbols:', err.message);
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}
