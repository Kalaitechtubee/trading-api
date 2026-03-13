import axios from 'axios';
import defaultDeltaSymbols from '../config/deltaSymbols.js';

let cachedDeltaSymbols = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Fetch perpetual futures symbols listed on Delta Exchange
 * Automatically caches for 1 hour to prevent rate limiting
 * @returns {Promise<string[]>} Array of symbol strings (e.g., ['BTCUSDT', 'ETHUSDT'])
 */
export async function getDeltaSymbols() {
    const now = Date.now();
    // Return cached symbols if still valid
    if (cachedDeltaSymbols && (now - lastFetchTime < CACHE_DURATION)) {
        return cachedDeltaSymbols;
    }

    try {
        const res = await axios.get("https://api.delta.exchange/v2/products", { timeout: 10000 });
        if (res.data && res.data.result) {
            const symbols = res.data.result
                .filter(p => p.contract_type === "perpetual_futures")
                .map(p => p.symbol);
            
            if (symbols.length > 0) {
                cachedDeltaSymbols = symbols;
                lastFetchTime = now;
                return symbols;
            }
        }
    } catch (err) {
        console.warn(`[DeltaService] Failed to fetch symbols from Delta API: ${err.message}. Using fallback.`);
    }

    // Fallback to static list if API fails
    return defaultDeltaSymbols;
}
