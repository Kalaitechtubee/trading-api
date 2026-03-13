import { getCandles, getFuturesData, getOrderbook, getTopVolumeSymbols } from '../services/binanceService.js';
import { getForexCandles, isForexDisabled } from '../services/forexService.js';
import { sendSignalAlert } from '../services/telegramService.js';
import { addSignal } from '../memory/signalStore.js';
import { runAIAnalysis, analyzeTimeVolatility } from './technical.js';
import { ATR } from 'technicalindicators';
import { getCachedCandles, updateCandles } from '../memory/candleStore.js';
import { recordTrade, updateTradeStatus } from '../memory/backtestStore.js';
import { cacheCandles, getRedisCandles } from '../redis/candleCache.js';
import { getDeltaSymbols } from '../services/deltaService.js';
import scannerConfig from '../config/scannerConfig.js';

// ── Configuration ────────────────────────────────────────────
const {
    minScoreToAlert: MIN_SCORE_TO_ALERT,
    premiumSignalThreshold: PREMIUM_SIGNAL_THRESHOLD,
    minScoreToStore: MIN_SCORE_TO_STORE,
    debugSignals: DEBUG_SIGNALS,
    forexScanInterval: FOREX_SCAN_INTERVAL,
    defaultCryptoSymbols,
    forexSymbols: FOREX_SYMBOLS,
    timeframes: TIMEFRAMES,
    alertCooldownMs: COOLDOWN_MS
} = scannerConfig;

let CRYPTO_SYMBOLS = [...defaultCryptoSymbols];

// Alert cooldown map: symbol_timeframe → last alert timestamp
const alertCooldown = new Map();

/**
 * Check alert cooldown for a symbol/timeframe combo
 */
function canAlert(key) {
    const last = alertCooldown.get(key) || 0;
    return Date.now() - last > COOLDOWN_MS
}

/**
 * Get visual grade for a signal based on score
 */
function getSignalGrade(score) {
    if (score >= 82) return { grade: 'S', color: 'ELITE 👑' };
    if (score >= 75) return { grade: 'A', color: 'STRONG 💎' };
    if (score >= 70) return { grade: 'B', color: 'STABLE 🚀' };
    return { grade: 'C', color: 'WEAK ⚪' };
}

/**
 * Scan a single symbol on a single timeframe
 */
async function scanSymbol(symbol, timeframe) {
    try {
        // ... (existing caching logic remains)
        let candles = getCachedCandles(symbol, timeframe);
        
        if (!candles) {
            candles = await getRedisCandles(symbol, timeframe);
            if (candles) updateCandles(symbol, timeframe, candles);
        }

        const fetchCount = (!candles || candles.length < 200) ? 300 : 20;

        let freshCandles;
        if (symbol.includes("/")) {
            freshCandles = await getForexCandles(symbol, timeframe);
        } else {
            freshCandles = await getCandles(symbol, timeframe, fetchCount);
        }
        if (!freshCandles || freshCandles.length === 0) return null;

        updateCandles(symbol, timeframe, freshCandles);
        candles = getCachedCandles(symbol, timeframe);
        if (candles) await cacheCandles(symbol, timeframe, candles);

        if (!candles || candles.length < 200) return null;

        const close = candles.map(c => c.close);
        const atrVals = ATR.calculate({
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            close: close,
            period: 14
        });
        const lastATR = atrVals[atrVals.length - 1] ?? 0;
        const atrPct = (lastATR / close[close.length - 1]) * 100;

        if (atrPct < 0.02) return null;

        const [futuresData, depth] = await Promise.all([
            getFuturesData(symbol),
            getOrderbook(symbol, 50)
        ]);

        if (futuresData) futuresData.depth = depth;

        const result = await runAIAnalysis(candles, timeframe, symbol, futuresData);

        if (!result || result.error || !result.score) return null;

        result.marketType = symbol.includes("/") ? 'Forex' : 'Crypto';
        result.grade = getSignalGrade(result.score);

        // Store result for history
        addSignal(result);

        if (timeframe === '5m' && result.marketType === 'Crypto') {
            updateTradeStatus(symbol, result.price);
        }

        // We only log to console here if it's a valid signal to keep it clean, 
        // or we return the result for the summary in scanMarket.
        if (DEBUG_SIGNALS && result.action !== 'WAIT' && result.score >= MIN_SCORE_TO_ALERT) {
            const emoji = result.action === 'BUY' ? '🟢' : '🔴';
            console.log(`\n[Scanner] ${emoji} ${symbol.padStart(8)} ${timeframe.padStart(3)} → ${result.action} (${result.score}%) [Grade ${result.grade.grade}]`);
        }

        return result;

    } catch (err) {
        if (DEBUG_SIGNALS) console.error(`[Scanner] Error scanning ${symbol} ${timeframe}:`, err.message);
        return null;
    }
}

// ── Scanner State ─────────────────────────────────────────────
let isScanning = false;
let scanCount = 0;

/**
 * Main scan function — scans all symbols across all timeframes
 */
export async function scanMarket() {
    if (isScanning) return;

    isScanning = true;
    scanCount++;
    const startTime = Date.now();
    let allResults = [];

    try {
        // ── DYNAMIC SYMBOL UPDATING ──
        if (scanCount % 10 === 1) {
            const topList = await getTopVolumeSymbols(200);
            const deltaSymbols = await getDeltaSymbols();
            if (topList && topList.length > 10) {
                const filteredList = topList.filter(symbol => deltaSymbols.includes(symbol));
                CRYPTO_SYMBOLS = filteredList.length > 5 ? filteredList : topList;
                console.log(`[Scanner] Dynamic Symbol Update: ${CRYPTO_SYMBOLS.length} Delta Exchange coins loaded.`);
            }
        }

        const shouldScanForex = !isForexDisabled() && (scanCount % FOREX_SCAN_INTERVAL === 1);
        
        console.log(`[Scanner] ═══ Scan #${scanCount} | ${CRYPTO_SYMBOLS.length} crypto${shouldScanForex ? ` + ${FOREX_SYMBOLS.length} forex` : ''} ═══`);

        // ── 1. Crypto Scanning (Parallel Groups) ──────────────────
        process.stdout.write(`[Scanner] Scanning Crypto Pairs... `);
        const cryptoChunks = [];
        const chunkSize = 5; // Scan 5 symbols in parallel
        for (let i = 0; i < CRYPTO_SYMBOLS.length; i += chunkSize) {
            cryptoChunks.push(CRYPTO_SYMBOLS.slice(i, i + chunkSize));
        }

        for (const chunk of cryptoChunks) {
            const chunkResults = await Promise.all(chunk.map(async (symbol) => {
                const results = await Promise.all(TIMEFRAMES.map(tf => scanSymbol(symbol, tf)));
                const validTfResults = results.filter(r => r !== null);
                return { symbol, results: validTfResults };
            }));

            for (const { symbol, results } of chunkResults) {
                allResults.push(...results);
                await processSignalResults(symbol, results);
            }
            // Small gap between chunks
            await new Promise(r => setTimeout(r, 500));
        }
        process.stdout.write(`done.\n`);

        // ── 2. Forex Scanning (Sequential) ───────────────────────
        if (shouldScanForex) {
            process.stdout.write(`[Scanner] Scanning Forex Pairs... `);
            for (const symbol of FOREX_SYMBOLS) {
                const tfResults = [];
                for (const tf of TIMEFRAMES) {
                    const res = await scanSymbol(symbol, tf);
                    if (res) tfResults.push(res);
                    await new Promise(r => setTimeout(r, 7600)); // Strict Forex Limit
                }
                allResults.push(...tfResults);
                await processSignalResults(symbol, tfResults);
            }
            process.stdout.write(`done.\n`);
        } else if (!isForexDisabled()) {
            console.log(`[Scanner] ⏭️  Forex SKIPPED (Next in ${FOREX_SCAN_INTERVAL - (scanCount % FOREX_SCAN_INTERVAL)} scan(s))`);
        }

        // ── Periodic Performance Log ───────────────────────────
        if (scanCount % 10 === 0) {
            try {
                const { getDailyStats } = await import('../services/dailyReport.js');
                const stats = getDailyStats();
                console.log(`\n📊 [Performance] Daily Stats: ${stats.win}W - ${stats.loss}L | WinRate: ${stats.winrate}% | Pending: ${stats.pending}`);
            } catch (e) { /* ignore */ }
        }

    } catch (err) {
        console.error('[Scanner] Master scan error:', err.message);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validSignals = allResults.filter(r => r && r.action !== 'WAIT' && r.score >= MIN_SCORE_TO_ALERT);
    
    if (validSignals.length > 0) {
        console.log(`\n[Scanner] 🎯 Signals Detected in Scan #${scanCount}:`);
        console.table(validSignals.map(s => ({
            Symbol: s.symbol,
            TF: s.timeframe,
            Action: s.action,
            Score: `${s.score}%`,
            Grade: s.grade?.grade || 'C',
            RR: s.riskReward
        })));
    }

    console.log(`[Scanner] ═══ Scan #${scanCount} complete in ${elapsed}s | ${validSignals.length} signals triggered ═══\n`);
    isScanning = false;
}

/**
 * Filter, Process and Send signals for a symbol
 */
async function processSignalResults(symbol, tfResults) {
    if (!tfResults || tfResults.length === 0) return;

    // 1. Score Filter
    const tfResultsFiltered = tfResults.filter(r => r.action !== 'WAIT' && r.score >= MIN_SCORE_TO_ALERT);

    // 2. MTF Alignment
    const m5  = tfResults.find(r => r.timeframe === '5m');
    const m15 = tfResults.find(r => r.timeframe === '15m');
    const h1  = tfResults.find(r => r.timeframe === '1h');
    const h4  = tfResults.find(r => r.timeframe === '4h');

    const mtfRoadmap = {
        m5: m5 ? m5.bias : 'Neutral',
        m15: m15 ? m15.bias : 'Neutral',
        h1: h1 ? h1.bias : 'Neutral',
        h4: h4 ? h4.bias : 'Neutral'
    };

    const validSignals = tfResultsFiltered.filter(sig => {
        sig.mtfRoadmap = mtfRoadmap;
        if (h4 && h4.bias) {
            const isCounter = (sig.action === 'BUY' && h4.bias === 'Bearish') || (sig.action === 'SELL' && h4.bias === 'Bullish');
            if (isCounter && sig.score < 82) return false;
        }
        if ((sig.timeframe === '5m' || sig.timeframe === '15m') && h1 && h1.trend) {
            const isCounter = (sig.action === 'BUY' && h1.trend === 'Bearish') || (sig.action === 'SELL' && h1.trend === 'Bullish');
            if (isCounter && sig.score < 78) return false;
        }
        return true;
    });

    // Logging Summary
    if (validSignals.length === 0) {
        const maxScore = Math.max(...tfResults.map(r => r.score || 0), 0);
        if (maxScore > 0) {
            // Only log if something interesting happened (score > 55)
            if (maxScore > 55) {
                console.log(`[Scanner] ⚪ ${symbol.padStart(8)} → No Strong Setup (Highest Score: ${maxScore}%)`);
            }
        }
        return;
    }

    // 3. Dispatch
    for (const sig of validSignals) {
        const cooldownKey = `${sig.symbol}_${sig.timeframe}`;
        if (!canAlert(cooldownKey)) continue;

        const isElite = (m5 && h1 && m15 && m5.bias === h1.bias && m5.bias === m15.bias);
        let label = sig.timeframe === '5m' ? '⚡ SCALP' : sig.timeframe === '15m' ? '🎯 INTRADAY' : sig.timeframe === '1h' ? '🏛️ SWING' : '📊 POSITION';
        if (isElite) label = '🚀 ELITE';
        if (sig.score >= PREMIUM_SIGNAL_THRESHOLD) label = '👑 PREMIUM';

        const dispatchSig = { ...sig, premiumLabel: label, isElite };

        try {
            await sendSignalAlert(dispatchSig);
            recordTrade(dispatchSig);
            alertCooldown.set(cooldownKey, Date.now());
            console.log(`[Scanner] 🔥 Signal Sent: ${sig.symbol} ${sig.timeframe} ${sig.action} [${label}] (${sig.score}%) [Grade ${sig.grade.grade}]`);
        } catch (err) {
            console.error(`[Scanner] ❌ Send failure for ${sig.symbol}:`, err.message);
        }
    }
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
