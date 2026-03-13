/**
 * TREADING AI — Daily Performance Reporting
 * Calculates statistics from stored trades in JSON.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRADES_FILE = path.join(__dirname, '../memory/trades.json');

/**
 * Calculate trade statistics for Today
 * @returns {Object} Statistics object
 */
export function getDailyStats() {
    try {
        if (!fs.existsSync(TRADES_FILE)) {
            return { total: 0, win: 0, loss: 0, expired: 0, pending: 0, winrate: 0 };
        }

        const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        
        // Use local date string (YYYY-MM-DD) for consistency
        const today = new Date().toISOString().split('T')[0];
        
        // Filter trades from today or closed today
        const todayTrades = trades.filter(t => {
            const tradeDate = new Date(t.timestamp).toISOString().split('T')[0];
            const closeDate = t.closedAt ? new Date(t.closedAt).toISOString().split('T')[0] : null;
            return tradeDate === today || closeDate === today;
        });

        let win = 0;
        let loss = 0;
        let expired = 0;
        let pending = 0;

        todayTrades.forEach(t => {
            if (t.status === 'WIN') win++;
            else if (t.status === 'LOSS') loss++;
            else if (t.status === 'EXPIRED') expired++;
            else if (t.status === 'PENDING') pending++;
        });

        const totalResolved = win + loss;
        const winrate = totalResolved ? ((win / totalResolved) * 100).toFixed(1) : 0;

        return {
            total: todayTrades.length,
            win,
            loss,
            expired,
            pending,
            winrate,
            date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        };
    } catch (err) {
        console.error('[DailyReport] Error calculating stats:', err.message);
        return { total: 0, win: 0, loss: 0, expired: 0, pending: 0, winrate: 0 };
    }
}
