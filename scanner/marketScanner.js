import { getCandles, getFuturesData, getOrderbook, getTopVolumeSymbols } from '../services/binanceService.js';
import { sendSignalAlert } from '../services/telegramService.js';
import { addSignal } from '../memory/signalStore.js';
import { runAIAnalysis } from './technical.js';
import { ATR } from 'technicalindicators';
import { getCachedCandles, updateCandles } from '../memory/candleStore.js';

// ── Configuration ────────────────────────────────────────────
// Minimum score to store and alert on
const MIN_SCORE_TO_ALERT = 75; // Increased to 75
const PREMIUM_SIGNAL_THRESHOLD = 82; // Elite level
const MIN_SCORE_TO_STORE = 55;

// Professional Scalping Symbols (High Liquidity / Quality)
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'POLUSDT'
];

// Scalping + Intraday Timeframes: 5m (Entry), 15m (Setup), 1h (Trend)
const TIMEFRAMES = ['5m', '15m', '1h'];

// Alert cooldown map: symbol_timeframe → last alert timestamp
const alertCooldown = new Map();
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// ── Scanner State ─────────────────────────────────────────────
let isScanning = false;
let scanCount = 0;

/**
 * Check alert cooldown for a symbol/timeframe combo
 */
function canAlert(key) {
    const last = alertCooldown.get(key) || 0;
    return Date.now() - last > COOLDOWN_MS;
}

/**
 * Scan a single symbol on a single timeframe
 */
async function scanSymbol(symbol, timeframe) {
    try {
        // ── Candle Cache System ───────────────────────────────────
        let candles = getCachedCandles(symbol, timeframe);

        // If not in cache or very stale, fetch full history (300)
        // Otherwise fetch just enough to catch up (e.g. 5)
        const fetchCount = (!candles || candles.length < 5) ? 300 : 5;

        const freshCandles = await getCandles(symbol, timeframe, fetchCount);
        if (!freshCandles || freshCandles.length === 0) return;

        // Update memory cache and get full history
        updateCandles(symbol, timeframe, freshCandles);
        candles = getCachedCandles(symbol, timeframe);

        if (!candles || candles.length < 50) return;

        // ── Volatility Filter ─────────────────────────────────────
        const close = candles.map(c => c.close);
        const atrVals = ATR.calculate({
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            close: close,
            period: 14
        });
        const lastATR = atrVals[atrVals.length - 1] ?? 0;
        const atrPct = (lastATR / close[close.length - 1]) * 100;

        if (atrPct < 0.08) return;

        // Fetch futures data and Orderbook depth (Parallel)
        const [futuresData, depth] = await Promise.all([
            getFuturesData(symbol),
            getOrderbook(symbol, 50)
        ]);

        // Attach depth to futuresData for the technical engine
        if (futuresData) futuresData.depth = depth;

        // Run full technical analysis
        const result = runAIAnalysis(candles, timeframe, symbol, futuresData);
        if (result.error) return;

        // Always store scan results so the React UI always has data
        addSignal(result);

        if (result.score >= MIN_SCORE_TO_STORE) {
            console.log(`[Scanner] ${symbol.padStart(8)} ${timeframe.padStart(3)} → ${result.action.padEnd(6)} (${result.score}%) [${result.strengthLabel}]`);
        }

        return result;

    } catch (err) {
        console.error(`[Scanner] Error scanning ${symbol} ${timeframe}:`, err.message);
        return null;
    }
}

/**
 * Main scan function — scans all symbols across all timeframes
 * Called on an interval by the server.
 */
export async function scanMarket() {
    if (isScanning) {
        console.log('[Scanner] Previous scan still in progress, skipping...');
        return;
    }

    isScanning = true;
    scanCount++;
    console.log(`\n[Scanner] ═══ Scan #${scanCount} started at ${new Date().toLocaleTimeString()} ═══`);

    const startTime = Date.now();

    try {
        const allResults = [];

        // Parallel scanning for all symbols
        const scanPromises = SYMBOLS.map(async (symbol) => {
            const tfResults = await Promise.all(TIMEFRAMES.map(tf => scanSymbol(symbol, tf)));
            allResults.push(...tfResults.filter(r => r !== null));
            await new Promise(r => setTimeout(r, 200));
        });

        await Promise.all(scanPromises);

        // ── ELITE SIGNAL FILTERING ──
        // 1. Filter candidates (Score >= 75)
        let candidates = allResults.filter(r => r.score >= MIN_SCORE_TO_ALERT && r.action !== 'WAIT');

        // 2. Multi-Timeframe Confirmation (5m + 15m same direction)
        const eliteSignals = [];
        const processedPairs = new Set();

        for (const sig of candidates) {
            const key = `${sig.symbol}_${sig.timeframe}`;
            if (processedPairs.has(key)) continue;

            const m5 = allResults.find(r => r.symbol === sig.symbol && r.timeframe === '5m');
            const m15 = allResults.find(r => r.symbol === sig.symbol && r.timeframe === '15m');

            if (m5 && m15 && m5.action === m15.action && m5.action !== 'WAIT') {
                // If MTF matches, prioritize the 15m signal for the alert
                const bestSig = m15.score >= m5.score ? m15 : m5;

                if (canAlert(`${sig.symbol}_ELITE`)) {
                    eliteSignals.push({
                        ...bestSig,
                        isElite: true,
                        mtfConfirmed: true,
                        mtfScore: Math.round((m5.score + m15.score) / 2)
                    });
                }
            }
            processedPairs.add(key);
        }

        // 3. Limit to Top 2 Elite Signals per scan
        const topElites = eliteSignals
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

        for (const elite of topElites) {
            const premiumLabel = elite.score >= PREMIUM_SIGNAL_THRESHOLD ? '👑 PREMIUM' : '🚀 ELITE';
            await sendSignalAlert({ ...elite, premiumLabel });
            alertCooldown.set(`${elite.symbol}_ELITE`, Date.now());
            console.log(`[Scanner] ${premiumLabel} alert sent: ${elite.symbol} ${elite.action} at ${elite.score}%`);
        }

    } catch (err) {
        console.error('[Scanner] Master scan error:', err.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scanner] ═══ Scan #${scanCount} complete in ${elapsed}s (Top 10 Coins / 3 TFs) ═══\n`);
    isScanning = false;
}

/**
 * Get scanner configuration info
 */
export function getScannerInfo() {
    return {
        symbols: SYMBOLS,
        timeframes: TIMEFRAMES,
        minScoreToStore: MIN_SCORE_TO_STORE,
        minScoreToAlert: MIN_SCORE_TO_ALERT,
        cooldownMinutes: COOLDOWN_MS / 60000,
        scanCount,
        isScanning
    };
}
