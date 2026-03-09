import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure memory directory exists
const MEMORY_DIR = __dirname;
const TRADES_FILE = path.join(MEMORY_DIR, 'trades.json');

let trades = [];

// Load existing trades
try {
    if (fs.existsSync(TRADES_FILE)) {
        trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        console.log(`[BacktestStore] Loaded ${trades.length} historical trades`);
    }
} catch (err) {
    console.error('[BacktestStore] Failed to load trades:', err.message);
}

/**
 * Persist trades to JSON file
 */
export function saveTrades() {
    try {
        fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
    } catch (err) {
        console.error('[BacktestStore] Failed to save trades:', err.message);
    }
}

/**
 * Record a new signal for backtesting
 * @param {Object} signal 
 */
export function recordTrade(signal) {
    // Only record BUY/SELL signals
    if (signal.action === 'WAIT') return;

    const trade = {
        id: `T-${Date.now()}-${signal.symbol}`,
        symbol: signal.symbol,
        action: signal.action,
        entryPrice: signal.price,
        stopLoss: signal.stopLoss,
        target: signal.target,
        timestamp: signal.timestamp || Date.now(),
        timeframe: signal.timeframe,
        score: signal.score,
        status: 'PENDING', // PENDING, WIN, LOSS, EXPIRED
        exitPrice: null,
        profit: null,
        closedAt: null
    };

    trades.push(trade);
    saveTrades();
    console.log(`[BacktestStore] 📝 Recorded Pending Trade: ${signal.symbol} ${signal.action} @ ${signal.price}`);
}

/**
 * Update pending trades based on current price
 * @param {string} symbol 
 * @param {number} currentPrice 
 */
export function updateTradeStatus(symbol, currentPrice) {
    let changed = false;
    const now = Date.now();

    trades.forEach(t => {
        if (t.symbol === symbol && t.status === 'PENDING') {
            if (t.action === 'BUY') {
                if (currentPrice >= t.target) {
                    t.status = 'WIN';
                    t.exitPrice = currentPrice;
                    t.profit = currentPrice - t.entryPrice;
                    t.closedAt = now;
                    changed = true;
                    console.log(`[BacktestStore] ✅ WIN: ${t.symbol} BUY hit Target @ ${currentPrice}`);
                } else if (currentPrice <= t.stopLoss) {
                    t.status = 'LOSS';
                    t.exitPrice = currentPrice;
                    t.profit = currentPrice - t.entryPrice;
                    t.closedAt = now;
                    changed = true;
                    console.log(`[BacktestStore] ❌ LOSS: ${t.symbol} BUY hit StopLoss @ ${currentPrice}`);
                }
            } else if (t.action === 'SELL') {
                if (currentPrice <= t.target) {
                    t.status = 'WIN';
                    t.exitPrice = currentPrice;
                    t.profit = t.entryPrice - currentPrice;
                    t.closedAt = now;
                    changed = true;
                    console.log(`[BacktestStore] ✅ WIN: ${t.symbol} SELL hit Target @ ${currentPrice}`);
                } else if (currentPrice >= t.stopLoss) {
                    t.status = 'LOSS';
                    t.exitPrice = currentPrice;
                    t.profit = t.entryPrice - currentPrice;
                    t.closedAt = now;
                    changed = true;
                    console.log(`[BacktestStore] ❌ LOSS: ${t.symbol} SELL hit StopLoss @ ${currentPrice}`);
                }
            }

            // Auto-expire after 4 hours if not hit (scalping usually resolves fast)
            if (t.status === 'PENDING' && now - t.timestamp > 4 * 60 * 60 * 1000) {
                t.status = 'EXPIRED';
                t.closedAt = now;
                changed = true;
                console.log(`[BacktestStore] 🕒 EXPIRED: ${t.symbol} trade took too long`);
            }
        }
    });

    if (changed) saveTrades();
}

/**
 * Get backtesting statistics
 */
export function getBacktestStats() {
    const closed = trades.filter(t => t.status === 'WIN' || t.status === 'LOSS');
    const wins = closed.filter(t => t.status === 'WIN').length;
    const losses = closed.filter(t => t.status === 'LOSS').length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    // Calculate total RR
    // RR = (TP - Entry) / (Entry - SL)

    return {
        totalTrades: trades.length,
        closedTrades: closed.length,
        wins,
        losses,
        winRate: winRate.toFixed(1) + '%',
        totalProfit: closed.reduce((sum, t) => sum + (t.profit || 0), 0).toFixed(4),
        pending: trades.filter(t => t.status === 'PENDING').length,
        history: trades.slice(-50) // Last 50 trades
    };
}

export function getAllTrades() {
    return trades;
}
