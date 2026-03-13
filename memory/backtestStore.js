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

    // Prevention: Don't record duplicate if same symbol/TF is already pending
    const isAlreadyPending = trades.some(t => 
        t.symbol === signal.symbol && 
        t.timeframe === signal.timeframe && 
        t.status === 'PENDING'
    );

    if (isAlreadyPending) return;

    const trade = {
        id: `T-${Date.now()}-${signal.symbol}-${signal.timeframe}`,
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
    console.log(`[BacktestStore] 📝 Recorded Pending Trade: ${signal.symbol} ${signal.action} (${signal.timeframe}) @ ${signal.price}`);
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

    // Advanced Stats
    const statsByHour = {};
    const statsBySymbol = {};
    const statsByTimeframe = {};

    closed.forEach(t => {
        const hour = new Date(t.timestamp).getUTCHours();
        const symbol = t.symbol;
        const tf = t.timeframe;

        // Hour stats
        if (!statsByHour[hour]) statsByHour[hour] = { wins: 0, total: 0 };
        statsByHour[hour].total++;
        if (t.status === 'WIN') statsByHour[hour].wins++;

        // Symbol stats
        if (!statsBySymbol[symbol]) statsBySymbol[symbol] = { wins: 0, total: 0 };
        statsBySymbol[symbol].total++;
        if (t.status === 'WIN') statsBySymbol[symbol].wins++;

        // Timeframe stats
        if (!statsByTimeframe[tf]) statsByTimeframe[tf] = { wins: 0, total: 0 };
        statsByTimeframe[tf].total++;
        if (t.status === 'WIN') statsByTimeframe[tf].wins++;
    });

    const formatBreakdown = (obj) => {
        const result = {};
        Object.keys(obj).forEach(key => {
            const wr = (obj[key].wins / obj[key].total * 100).toFixed(1);
            result[key] = `${wr}% (${obj[key].wins}/${obj[key].total})`;
        });
        return result;
    };

    return {
        totalTrades: trades.length,
        closedTrades: closed.length,
        wins,
        losses,
        winRate: winRate.toFixed(1) + '%',
        totalProfit: closed.reduce((sum, t) => sum + (t.profit || 0), 0).toFixed(4),
        pending: trades.filter(t => t.status === 'PENDING').length,
        breakdownByHour: formatBreakdown(statsByHour),
        breakdownBySymbol: formatBreakdown(statsBySymbol),
        breakdownByTimeframe: formatBreakdown(statsByTimeframe),
        history: trades.slice(-50)
    };
}

export function getAllTrades() {
    return trades;
}
