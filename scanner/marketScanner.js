import { getCandles, getFuturesData, getOrderbook, getTopVolumeSymbols } from '../services/binanceService.js';
import { sendSignalAlert } from '../services/telegramService.js';
import { addSignal } from '../memory/signalStore.js';
import { runAIAnalysis } from './technical.js';
import { ATR } from 'technicalindicators';
import { getCachedCandles, updateCandles } from '../memory/candleStore.js';

// ── Configuration ────────────────────────────────────────────
// Minimum score to store and alert on
const MIN_SCORE_TO_ALERT = 72; // Slightly relaxed to catch more quality signals
const PREMIUM_SIGNAL_THRESHOLD = 82; // Elite level
const MIN_SCORE_TO_STORE = 55;

// Professional Scalping Symbols (High Liquidity / Quality Fallback)
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'POLUSDT',
    'TRXUSDT', 'LTCUSDT', 'DOTUSDT', 'MATICUSDT', 'ATOMUSDT'
];

// ✅ Whitelist: Only high-liquidity, institutional-grade coins
// Blocks low-quality coins like BANANAS31USDT, SIGNUSDT, OPNUSDT etc.
const ALLOWED = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'TRXUSDT',
    'LTCUSDT', 'ATOMUSDT', 'DOTUSDT', 'SUIUSDT', 'MATICUSDT'
];

// Scalping + Intraday Timeframes: 5m (Entry), 15m (Setup), 1h (Structure/Trend Bias)
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
        if (!freshCandles || freshCandles.length === 0) {
            console.log(`[Scanner] Skipping ${symbol} ${timeframe}: API failure or no data`);
            return null;
        }

        // Update memory cache and get full history
        updateCandles(symbol, timeframe, freshCandles);
        candles = getCachedCandles(symbol, timeframe);

        if (!candles || candles.length < 50) return null;

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

        if (atrPct < 0.08) return null;

        // Fetch futures data and Orderbook depth (Parallel)
        const [futuresData, depth] = await Promise.all([
            getFuturesData(symbol),
            getOrderbook(symbol, 50)
        ]);

        // Attach depth to futuresData for the technical engine
        if (futuresData) futuresData.depth = depth;

        // Run full technical analysis
        const result = runAIAnalysis(candles, timeframe, symbol, futuresData);

        // Safety check for analysis result
        if (!result || result.error || !result.score) {
            return null;
        }

        // Always store scan results so the React UI always has data
        addSignal(result);

        // Log every scan so user can see all coins being processed
        const emoji = result.action === 'BUY' ? '🟢' : result.action === 'SELL' ? '🔴' : '⚪';
        console.log(`[Scanner] ${emoji} ${symbol.padStart(8)} ${timeframe.padStart(3)} → ${result.action.padEnd(6)} (${result.score}%) [${result.strengthLabel}]`);

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

        // ── Dynamic Symbols Discovery ─────────────────────────────
        // Fetch top volume symbols from Binance to ensure we scan the most active markets
        let activeSymbols = SYMBOLS;
        try {
            const topVol = await getTopVolumeSymbols(15);
            if (topVol && topVol.length > 0) {
                // ✅ Filter to only whitelisted high-liquidity coins
                const filtered = topVol.filter(s => ALLOWED.includes(s));
                activeSymbols = filtered.length > 0 ? filtered : SYMBOLS;
            }
        } catch (e) {
            console.warn('[Scanner] Failed to fetch dynamic symbols, falling back to static list');
        }

        // Sequential scanning for all symbols (Avoids API bursts/timeouts)
        for (const symbol of activeSymbols) {
            try {
                // Timeframes can still be parallel for a single symbol
                const tfResults = await Promise.all(TIMEFRAMES.map(tf => scanSymbol(symbol, tf)));
                allResults.push(...tfResults.filter(r => r !== null));

                // Small gap between symbols
                await new Promise(r => setTimeout(r, 400)); // Slightly faster scan
            } catch (err) {
                console.error(`[Scanner] Symbol loop error for ${symbol}:`, err.message);
            }
        }

        // ── ELITE SIGNAL FILTERING ──
        // 1. Filter candidates (Score >= 75 and not WAIT)
        let candidates = allResults.filter(r => r.score >= MIN_SCORE_TO_ALERT && r.action !== 'WAIT');

        const eliteSignals = [];
        const processedSymbols = new Set();

        for (const sig of candidates) {
            if (processedSymbols.has(sig.symbol)) continue;

            const m5 = allResults.find(r => r.symbol === sig.symbol && r.timeframe === '5m');
            const m15 = allResults.find(r => r.symbol === sig.symbol && r.timeframe === '15m');
            const h1 = allResults.find(r => r.symbol === sig.symbol && r.timeframe === '1h');

            if (m5 && m15 && h1) {
                // Scalping MTF: 5m entry must align with 15m + 1h bias
                const isBullishSetup = (m5.action === 'BUY' && m15.bias === 'Bullish' && h1.bias === 'Bullish');
                const isBearishSetup = (m5.action === 'SELL' && m15.bias === 'Bearish' && h1.bias === 'Bearish');

                if (isBullishSetup || isBearishSetup) {
                    if (canAlert(`${sig.symbol}_ELITE`)) {
                        eliteSignals.push({
                            ...m5,
                            isElite: true,
                            mtfConfirmation: 'Strong',
                            mtfScore: Math.round((m5.score * 0.5) + (m15.score * 0.35) + (h1.score * 0.15)),
                            mtfRoadmap: {
                                h1: h1.bias,
                                m15: m15.bias,
                                m5: m5.action
                            }
                        });
                        processedSymbols.add(sig.symbol);
                    }
                } else {
                    // Detailed Log for Why it Failed
                    console.log(`[Scanner] ${sig.symbol.padStart(8)} → MTF Rejected: 1H(${h1.bias}), 15M(${m15.bias}) vs 5M(${sig.action})`);
                }
            }
        }

        // 3. Limit to Top 2 Elite Signals per scan
        const topElites = eliteSignals
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

        for (const elite of topElites) {
            const premiumLabel = elite.score >= PREMIUM_SIGNAL_THRESHOLD ? '👑 PREMIUM' : '🚀 ELITE';
            await sendSignalAlert({ ...elite, premiumLabel });
            alertCooldown.set(`${elite.symbol}_ELITE`, Date.now());
            console.log(`[Scanner] 🔥 ${premiumLabel} ALERT SENT: ${elite.symbol} ${elite.action} (MTF Aligned 1H/15M/5M)`);
        }

    } catch (err) {
        console.error('[Scanner] Master scan error:', err.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scanner] ═══ Scan #${scanCount} complete in ${elapsed}s (Top 15 Active Markets / 4 TFs) ═══\n`);
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
