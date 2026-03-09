/**
 * TREADING AI — Signals API Route
 * Exposes signal data to the React frontend.
 */

import express from 'express';
import { getSignals, getFilteredSignals, getTopSignals, getScannerStatus } from '../memory/signalStore.js';
import { getScannerInfo } from '../scanner/marketScanner.js';
import { getBacktestStats } from '../memory/backtestStore.js';

const router = express.Router();

/**
 * GET /api/signals/backtest
 * Returns backtest stats and trade history
 */
router.get('/backtest', (req, res) => {
    res.json({
        success: true,
        stats: getBacktestStats()
    });
});

/**
 * GET /api/signals
 * Returns all stored signals (most recent first)
 * Optional query: ?symbol=BTCUSDT&action=BUY&minScore=65&limit=50
 */
router.get('/', (req, res) => {
    const { symbol, action, minScore, limit } = req.query;

    let signals;
    if (symbol || action || minScore) {
        signals = getFilteredSignals({
            symbol,
            action,
            minScore: minScore ? parseFloat(minScore) : undefined
        });
    } else {
        signals = getSignals();
    }

    const limitNum = limit ? parseInt(limit) : 100;
    res.json({
        success: true,
        count: Math.min(signals.length, limitNum),
        signals: signals.slice(0, limitNum)
    });
});

/**
 * GET /api/signals/top
 * Returns top 10 signals sorted by score
 * Optional query: ?n=10
 */
router.get('/top', (req, res) => {
    const n = req.query.n ? parseInt(req.query.n) : 10;
    res.json({
        success: true,
        signals: getTopSignals(n)
    });
});

/**
 * GET /api/signals/status
 * Returns scanner health + summary statistics
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        status: getScannerStatus(),
        scanner: getScannerInfo(),
        serverTime: new Date().toISOString()
    });
});

/**
 * GET /api/signals/:symbol
 * Returns signals filtered for a specific symbol
 */
router.get('/:symbol', (req, res) => {
    const { symbol } = req.params;
    const signals = getFilteredSignals({ symbol: symbol.toUpperCase() });
    res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        count: signals.length,
        signals
    });
});

export default router;
