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
import { sendToSheet } from '../services/googleSheetService.js';
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

        // We only log to console via the processSignalResults summary to avoid clutter
        // and focus only on strict 4-TF aligned signals.


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
                // Visual progress for the user
                if (DEBUG_SIGNALS) {
                    const statusParts = results.map(r => {
                        const emoji = r.action === 'BUY' ? '🟢' : r.action === 'SELL' ? '🔴' : '⚪';
                        return `${r.timeframe}:${emoji}${r.score}%`;
                    });
                    const hasAction = results.some(r => r.action !== 'WAIT');
                    const prefix = hasAction ? '🔥' : '🔍';
                    // Clear line before printing to handle different lengths
                    process.stdout.write(`\r${' '.repeat(80)}\r`); 
                    process.stdout.write(`[Scanner] ${prefix} Scanning: ${symbol.padEnd(10)} [${statusParts.join(' | ')}]`);
                }

                const signal = await processSignalResults(symbol, results);
                if (signal) {
                    process.stdout.write(`\n`); // Move to next line if signal triggered
                    allResults.push(signal);
                }
            }
            // Small gap between chunks
            await new Promise(r => setTimeout(r, 500));
        }
        process.stdout.write(`\n[Scanner] ✅ Crypto Scan Complete.\n`);

        // ── 2. Forex Scanning (Sequential) ───────────────────────
        if (shouldScanForex) {
            console.log(`[Scanner] 🌍 Scanning Forex Pairs (Sequential)...`);
            for (const symbol of FOREX_SYMBOLS) {
                const tfResults = [];
                for (const tf of TIMEFRAMES) {
                    const status = tfResults.map(r => {
                        const emoji = r.action === 'BUY' ? '🟢' : r.action === 'SELL' ? '🔴' : '⚪';
                        return `${r.timeframe}:${emoji}${r.score}%`;
                    }).join(' | ') || 'Pending...';

                    process.stdout.write(`\r${' '.repeat(80)}\r`);
                    process.stdout.write(`[Scanner] 🌍 Forex: ${symbol.padEnd(10)} [${status} | ${tf}:⏳]`);
                    
                    const res = await scanSymbol(symbol, tf);
                    if (res) tfResults.push(res);
                    await new Promise(r => setTimeout(r, 7600)); // Strict Forex Limit
                }
                const signal = await processSignalResults(symbol, tfResults);
                if (signal) {
                    process.stdout.write(`\n`);
                    allResults.push(signal);
                }
            }
            process.stdout.write(`\n[Scanner] ✅ Forex Scan Complete.\n`);
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
    const validSignals = allResults; // Now allResults only contains aligned ones
    
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
 * Requirement: All timeframes (5m, 15m, 1h, 4h) must align.
 */
async function processSignalResults(symbol, tfResults) {
    if (!tfResults || tfResults.length === 0) return null;

    // 1. Identify key timeframes
    const m5  = tfResults.find(r => r.timeframe === '5m');
    const m15 = tfResults.find(r => r.timeframe === '15m');
    const h1  = tfResults.find(r => r.timeframe === '1h');
    const h4  = tfResults.find(r => r.timeframe === '4h');

    // 2. Check if ALL required timeframes are present and successfully scanned
    const allPresent = m5 && m15 && h1 && h4;
    
    // 3. MTF Roadmap (for visual feedback in alert)
    const mtfRoadmap = {
        m5: m5 ? m5.bias : 'Neutral',
        m15: m15 ? m15.bias : 'Neutral',
        h1: h1 ? h1.bias : 'Neutral',
        h4: h4 ? h4.bias : 'Neutral'
    };

    if (!allPresent) {
        if (DEBUG_SIGNALS && tfResults.some(r => r.score >= MIN_SCORE_TO_ALERT)) {
            console.log(`[Scanner] ⚪ ${symbol.padStart(8)} → Missing data for some TFs (Required: 5m, 15m, 1h, 4h)`);
        }
        return null;
    }

    // 4. Directional Alignment: STRICT 4-TF REQUIREMENT
    const action = m5.action;
    if (action === 'WAIT') return null;

    // Must have same action on ALL timeframes
    const isAligned = tfResults.every(r => r.action === action);
    
    // 5. Score Check: ALL timeframes must pass threshold for maximum accuracy
    const allPassThreshold = tfResults.every(r => r.score >= MIN_SCORE_TO_ALERT);

    if (!isAligned || !allPassThreshold) {
        if (DEBUG_SIGNALS && (m5.score > 80)) {
            process.stdout.write(`\n`); // Break the progress line before logging filters
            console.log(`[Scanner] ⚪ ${symbol.padStart(8)} → Alignment Filtered (Required: 4/4 Align)`);
        }
        return null;
    }

    // 6. Dispatch Aligned Signal
    // We use the 5m as the entry reference but enrich it with the 4-TF context
    const sig = { ...m5 };
    sig.mtfRoadmap = mtfRoadmap;
    
    const cooldownKey = `${sig.symbol}_${sig.action}_MTF`;
    if (!canAlert(cooldownKey)) return null;

    // Give it a special label
    let label = '💎 4-TF ALIGNED';
    if (sig.score >= PREMIUM_SIGNAL_THRESHOLD) label = '👑 PREMIUM MTF';
    else if (sig.score >= 75) label = '🚀 ELITE MTF';

    const dispatchSig = { ...sig, premiumLabel: label, isElite: true };

    try {
        await sendSignalAlert(dispatchSig);
        recordTrade(dispatchSig);
        await sendToSheet(dispatchSig);
        
        // Cooldown for this symbol to avoid spamming the same alignment
        alertCooldown.set(cooldownKey, Date.now());
        
        console.log(`\n[Scanner] 🎯 CONFLUENCE DETECTED: ${sig.symbol} [${sig.action}] aligned on ALL 4 TFs! (${sig.score}% Entry score)`);
        return dispatchSig;
    } catch (err) {
        console.error(`[Scanner] ❌ Dispatch failure:`, err.message);
        return null;
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
