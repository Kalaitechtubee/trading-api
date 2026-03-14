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

    // Try multiple API endpoints to get a complete list of products
    // Note: india.delta.exchange often provides a more comprehensive list for users in that region
    const endpoints = [
        "https://api.india.delta.exchange/v2/products",
        "https://api.delta.exchange/v2/products"
    ];

    for (const url of endpoints) {
        try {
            console.log(`[DeltaService] Fetching symbols from ${url}...`);
            const res = await axios.get(url, { timeout: 10000 });
            
            if (res.data && res.data.result) {
                const products = res.data.result.filter(p => 
                    p.contract_type === "perpetual_futures" || p.contract_type === "futures"
                );

                if (products.length > 0) {
                    const normalizedSymbols = new Set();
                    
                    products.forEach(p => {
                        const s = p.symbol;
                        normalizedSymbols.add(s);
                        
                        // Delta often uses 'BTCUSD' for perps, while Binance uses 'BTCUSDT'
                        // We add normalized versions to ensure matching in marketScanner
                        if (s.endsWith('USD')) {
                            normalizedSymbols.add(s + 'T'); // BTCUSD -> BTCUSDT
                        }
                    });

                    cachedDeltaSymbols = Array.from(normalizedSymbols);
                    lastFetchTime = now;
                    console.log(`[DeltaService] Successfully loaded ${cachedDeltaSymbols.length} normalized symbols from ${url}`);
                    return cachedDeltaSymbols;
                }
            }
        } catch (err) {
            console.warn(`[DeltaService] Failed to fetch symbols from ${url}: ${err.message}`);
        }
    }

    console.error(`[DeltaService] All symbol fetch attempts failed. Using static fallback.`);
    // Fallback to static list if API fails
    return defaultDeltaSymbols;
}
