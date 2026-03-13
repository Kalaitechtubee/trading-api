/**
 * TREADING AI — Redis Candle Cache
 * Optimized for high-speed retrieval of OHLCV data
 */
import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redis = null;
let isRedisConnected = false;

try {
    redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
            if (times > 3) return null; // stop retrying after 3 attempts
            return Math.min(times * 100, 2000);
        }
    });

    redis.on('connect', () => {
        isRedisConnected = true;
        console.log('[Redis] 🚀 Connected to cache');
    });

    redis.on('error', (err) => {
        isRedisConnected = false;
        console.warn('[Redis] ⚠️ Connection failed, falling back to memory.');
    });
} catch (err) {
    console.error('[Redis] ❌ Critical initialization error:', err.message);
}

/**
 * Cache Candles
 * Key Format: candles:symbol:timeframe
 */
export async function cacheCandles(symbol, timeframe, candles) {
    if (!isRedisConnected || !redis) return false;
    
    try {
        const key = `candles:${symbol}:${timeframe}`;
        // Store as JSON string, expire in 2 hours (scalping data gets old fast)
        await redis.set(key, JSON.stringify(candles), 'EX', 7200);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Get Cached Candles
 */
export async function getRedisCandles(symbol, timeframe) {
    if (!isRedisConnected || !redis) return null;

    try {
        const key = `candles:${symbol}:${timeframe}`;
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        return null;
    }
}

/**
 * Clear cache for a symbol
 */
export async function clearCandleCache(symbol, timeframe) {
    if (!isRedisConnected || !redis) return;
    const key = `candles:${symbol}:${timeframe}`;
    await redis.del(key);
}

export default redis;
