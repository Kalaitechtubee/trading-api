/**
 * TREADING AI — Backend Server
 *
 * Starts the Express API server and the 24/7 market scanner loop.
 */

import express from 'express';
import cors from 'cors';
import { scanMarket } from './scanner/marketScanner.js';
import signalRoutes from './routes/signals.js';
import cron from 'node-cron';
import { sendDailyReport } from './services/telegramService.js';

import scannerConfig from './config/scannerConfig.js';

// ── Hardcoded Config (no .env needed) ────────────────────────
const PORT             = process.env.PORT || 5000;
const SCAN_INTERVAL_MS = 180000;   // 3 minutes
const FRONTEND_URL     = '';       // Set your production frontend URL here if needed

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
    origin: [
        'http://localhost:5173',        // Vite dev server
        'http://localhost:3000',        // CRA dev server
        FRONTEND_URL                    // Production frontend URL
    ].filter(Boolean),
    credentials: true
}));

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────
app.use('/api/signals', signalRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        name: 'Treading AI Backend Scanner',
        version: '1.0.0',
        uptime: process.uptime().toFixed(0) + 's',
        port: PORT,
        scanIntervalSeconds: SCAN_INTERVAL_MS / 1000,
        time: new Date().toISOString()
    });
});

// Root
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Treading AI Backend Scanner is running',
        endpoints: {
            health: '/health',
            allSignals: '/api/signals',
            topSignals: '/api/signals/top',
            status: '/api/signals/status',
            bySymbol: '/api/signals/:symbol'
        }
    });
});

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       TREADING AI — Backend Scanner v1.0             ║
║       24/7 Autonomous Market Analysis Engine         ║
╚══════════════════════════════════════════════════════╝

  ✅ Server running on  → http://localhost:${PORT}
  ✅ API endpoint       → http://localhost:${PORT}/api/signals
  ✅ Health check       → http://localhost:${PORT}/health
  🔄 Scan interval      → every ${SCAN_INTERVAL_MS / 1000} seconds
  📡 Telegram alerts    → Enabled ✅
`);

    console.log('✅ All config hardcoded. Scanner is ready.');

    // ── Run initial scan immediately on startup ──────────────
    console.log('[Server] Running initial market scan...');
    scanMarket();

    // ── Schedule recurring scans ──────────────────────────── 
    setInterval(scanMarket, SCAN_INTERVAL_MS);

    // ── Schedule Daily Telegram Report (23:00 IST) ─────────
    cron.schedule('0 23 * * *', () => {
        console.log('[Cron] Triggering daily performance report...');
        sendDailyReport();
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });
});

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
    console.log('\n[Server] SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n[Server] SIGINT received. Shutting down gracefully...');
    process.exit(0);
});
