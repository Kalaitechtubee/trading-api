import { getCandles, getFuturesData, getOrderbook, getTopVolumeSymbols } from '../services/binanceService.js';
import { getForexCandles } from '../services/forexService.js';
import { sendSignalAlert } from '../services/telegramService.js';
import { addSignal } from '../memory/signalStore.js';
import { runAIAnalysis } from './technical.js';
import { ATR } from 'technicalindicators';
import { getCachedCandles, updateCandles } from '../memory/candleStore.js';
import { recordTrade, updateTradeStatus } from '../memory/backtestStore.js';

// ── Configuration ────────────────────────────────────────────
// Minimum score to store and alert on
const MIN_SCORE_TO_ALERT = 72; // Raised back to 72 to avoid fake signals
const PREMIUM_SIGNAL_THRESHOLD = 82;
const MIN_SCORE_TO_STORE = 60;

// Professional Scalping Symbols (High Liquidity)
let CRYPTO_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'POLUSDT',
    'TRXUSDT', 'LTCUSDT', 'DOTUSDT', 'MATICUSDT', 'ATOMUSDT',
    'SUIUSDT', 'APTUSDT', 'NEARUSDT', 'ARBUSDT', 'OPUSDT'
];

const FOREX_SYMBOLS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD",
    "EUR/JPY", "GBP/JPY" // Added EURJPY and GBPJPY
];

// Scalping + Intraday Timeframes: 5m (Entry), 15m (Setup), 1h (Structure/Trend Bias)
const TIMEFRAMES = ['5m', '15m', '1h'];

// Alert cooldown map: symbol_timeframe → last alert timestamp
const alertCooldown = new Map();
const COOLDOWN_MS = 12 * 60 * 1000; // Lowered from 15m to 12m

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

        // Always fetch 300 candles if cache is below 200 (EMA200 needs 200+ candles)
        // Otherwise top up with last 20 to stay current
        const fetchCount = (!candles || candles.length < 200) ? 300 : 20;

        let freshCandles;
        if (symbol.includes("/")) {
            freshCandles = await getForexCandles(symbol, timeframe);
        } else {
            freshCandles = await getCandles(symbol, timeframe, fetchCount);
        }
        if (!freshCandles || freshCandles.length === 0) {
            return null;
        }

        // Update memory cache and get full history
        updateCandles(symbol, timeframe, freshCandles);
        candles = getCachedCandles(symbol, timeframe);

        // EMA200 needs at least 200 candles — skip if insufficient
        if (!candles || candles.length < 200) {
            return null;
        }

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

        // Relaxed volatility filter for Forex or slow markets (Lowered from 0.05 to 0.02)
        if (atrPct < 0.02) return null;

        // Fetch futures data and Orderbook depth (Parallel)
        const [futuresData, depth] = await Promise.all([
            getFuturesData(symbol),
            getOrderbook(symbol, 50)
        ]);

        if (futuresData) futuresData.depth = depth;

        // Run full technical analysis
        const result = runAIAnalysis(candles, timeframe, symbol, futuresData);

        if (!result || result.error || !result.score) {
            return null;
        }

        result.marketType = symbol.includes("/") ? 'Forex' : 'Crypto';

        // Always store scan results
        addSignal(result);

        if (timeframe === '5m') {
            updateTradeStatus(symbol, result.price);
        }

        const emoji = result.action === 'BUY' ? '🟢' : result.action === 'SELL' ? '🔴' : '⚪';
        console.log(`[Scanner] ${emoji} ${symbol.padStart(8)} ${timeframe.padStart(3)} → ${result.action.padEnd(6)} (${result.score}%)`);

        return result;

    } catch (err) {
        return null;
    }
}

/**
 * Main scan function — scans all symbols across all timeframes
 */
export async function scanMarket() {
    if (isScanning) return;

    isScanning = true;
    scanCount++;
    const startTime = Date.now();

    try {
        // ── DYNAMIC SYMBOL UPDATING ──
        // Every 10 scans, refresh the crypto list with top 35 volume pairs
        if (scanCount % 10 === 1) {
            const topList = await getTopVolumeSymbols(50); // Increased from 35 to 50
            if (topList && topList.length > 10) {
                CRYPTO_SYMBOLS = topList;
                console.log(`[Scanner] Dynamic Symbol Update: ${CRYPTO_SYMBOLS.length} coins loaded.`);
            }
        }

        const allResults = [];
        const activeSymbols = [...CRYPTO_SYMBOLS, ...FOREX_SYMBOLS];

        console.log(`[Scanner] ═══ Scan #${scanCount} | ${activeSymbols.length} Symbols ═══`);

        for (const symbol of activeSymbols) {
            try {
                const isForex = symbol.includes("/");
                let tfResults = [];

                if (isForex) {
                    for (const tf of TIMEFRAMES) {
                        const res = await scanSymbol(symbol, tf);
                        if (res) tfResults.push(res);
                        // Delay for Forex API rate limits (7.6s aligns closer to 8/min limit)
                        await new Promise(r => setTimeout(r, 7600));
                    }
                } else {
                    const results = await Promise.all(TIMEFRAMES.map(tf => scanSymbol(symbol, tf)));
                    tfResults = results.filter(r => r !== null);
                    await new Promise(r => setTimeout(r, 200));
                }

                const tfResultsFiltered = tfResults.filter(r => r.action !== 'WAIT' && r.score >= MIN_SCORE_TO_ALERT);

                // Multi-Timeframe Alignment Check
                const m5 = tfResults.find(r => r.timeframe === '5m');
                const m15 = tfResults.find(r => r.timeframe === '15m');
                const h1 = tfResults.find(r => r.timeframe === '1h');

                const validSignals = tfResultsFiltered.filter(sig => {
                    if (sig.timeframe === '1h') return true; // 1H is the anchor
                    if (h1 && h1.bias) {
                        const isCounterTrend = (sig.action === 'BUY' && h1.bias.includes('Bearish')) || 
                                               (sig.action === 'SELL' && h1.bias.includes('Bullish'));
                        // Block counter-trend signals on lower TFs unless score is strongly convincing (>= 78)
                        if (isCounterTrend && sig.score < 78) return false;
                    }
                    return true;
                });

                for (const sig of validSignals) {
                    if (!canAlert(`${sig.symbol}_ALERT`)) continue;

                    // Determine Label
                    const isElite = (m5 && h1 && m15 && m5.bias === h1.bias && m5.bias === m15.bias);
                    let label = '⚡ SCALP';
                    if (sig.timeframe === '15m') label = '🎯 INTRADAY';
                    if (sig.timeframe === '1h') label = '🏛️ SWING';
                    if (isElite) label = '🚀 ELITE';
                    if (sig.score >= PREMIUM_SIGNAL_THRESHOLD) label = '👑 PREMIUM';

                    const dispatchSig = { ...sig, premiumLabel: label, isElite };

                    await sendSignalAlert(dispatchSig);
                    recordTrade(dispatchSig);
                    alertCooldown.set(`${sig.symbol}_ALERT`, Date.now());
                    console.log(`[Scanner] 🔥 Signal Sent: ${sig.symbol} ${sig.timeframe} ${sig.action} [${label}] (${sig.score}%)`);
                }

                allResults.push(...tfResults);
            } catch (err) {
                console.error(`[Scanner] Symbol loop error for ${symbol}:`, err.message);
            }
        }

    } catch (err) {
        console.error('[Scanner] Master scan error:', err.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scanner] ═══ Scan #${scanCount} complete in ${elapsed}s ═══\n`);
    isScanning = false;
}

/**
 * Get scanner configuration info
 */
export function getScannerInfo() {
    return {
        symbols: [...CRYPTO_SYMBOLS, ...FOREX_SYMBOLS],
        timeframes: TIMEFRAMES,
        minScoreToStore: MIN_SCORE_TO_STORE,
        minScoreToAlert: MIN_SCORE_TO_ALERT,
        cooldownMinutes: COOLDOWN_MS / 60000,
        scanCount,
        isScanning
    };
}
