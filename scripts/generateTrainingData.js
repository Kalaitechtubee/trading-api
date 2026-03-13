/**
 * ═══════════════════════════════════════════════════════════════
 * TREADING AI — Training Data Generator
 * ═══════════════════════════════════════════════════════════════
 *
 * Reads historical candle data and generates a CSV feature dataset
 * with 1-candle-ahead labels for training the ML model.
 *
 * Usage:
 *   node scripts/generateTrainingData.js BTCUSDT 15m 1000
 *
 * Output:
 *   ml/training_data.csv
 */

import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR, RSI, MACD, ADX } from 'technicalindicators';
import { getCandles } from '../services/binanceService.js';
import {
    detectMarketRegime,
    getSession,
    detectLiquiditySweep,
    calculateOrderbookImbalance
} from '../scanner/technical.js';
import {
    detectLiquidityClusters,
    detectBOS,
    calculateOrderflow
} from '../scanner/smartMoney.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SYMBOLS    = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const TIMEFRAMES = ['15m', '1h'];
const CANDLE_FETCH = 1000; // max per symbol/tf
const OUTPUT_PATH  = join(__dirname, '..', 'ml', 'training_data.csv');

// CSV Header
const HEADER = [
    'price', 'rsi', 'macd_histogram', 'volume_spike',
    'atr_pct', 'ema_trend', 'orderbook_imbalance',
    'liquidity_sweep', 'regime', 'session',
    'bos', 'whale_dominance', 'delta_ratio', 'cluster_score',
    'target_breakout', 'target_continuation', 'target_reversal'
].join(',');

// Encode regime to number
const regimeEnc = { 'BULLISH TREND': 1, 'BEARISH TREND': -1, 'RANGING': 0, 'VOLATILE': 0.5 };
// Encode session to number
const sessionEnc = { 'LONDON_OPEN': 1, 'NY_OVERLAP': 1, 'NEW_YORK': 0.7, 'ASIA': 0.3, 'LATE_NY': 0.1, 'DORMANT': 0 };
// Encode BOS to number
const bosEnc = { 'BULLISH_BOS': 1, 'BULLISH_CHOCH': 0.5, null: 0, 'BEARISH_CHOCH': -0.5, 'BEARISH_BOS': -1 };
// Encode whale dominance
const whaleEnc = { 'WHALE_BUY': 1, 'NEUTRAL': 0, 'WHALE_BALANCED': 0, 'WHALE_SELL': -1 };

async function generateForSymbol(symbol, timeframe) {
    console.log(`[DataGen] Fetching ${symbol} ${timeframe}...`);
    const candles = await getCandles(symbol, timeframe, CANDLE_FETCH);

    if (!candles || candles.length < 250) {
        console.warn(`[DataGen] Insufficient candles for ${symbol} ${timeframe}`);
        return [];
    }

    const prices = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const rsiArr  = RSI.calculate({ values: prices, period: 14 });
    const macdArr = MACD.calculate({ values: prices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const atrArr  = ATR.calculate({ high: highs, low: lows, close: prices, period: 14 });
    const ema200  = EMA.calculate({ values: prices, period: 200 });

    const rows = [];
    const WINDOW = 220; // start after enough candles for indicators

    for (let i = WINDOW; i < candles.length - 1; i++) {
        const slice = candles.slice(0, i + 1);
        const current = candles[i];
        const nextCandle = candles[i + 1];

        // Target 1: Breakout Probability
        // 1 if next candle makes a new 10-candle high or low and has a strong body
        const last10High = Math.max(...slice.slice(-10).map(c => c.high));
        const last10Low  = Math.min(...slice.slice(-10).map(c => c.low));
        const nextBody = Math.abs(nextCandle.close - nextCandle.open);
        const atrVal  = atrArr[i - (prices.length - atrArr.length)] ?? 0;
        const isBreakout = (nextCandle.high > last10High || nextCandle.low < last10Low) && (nextBody > atrVal * 0.5) ? 1 : 0;

        // Target 2: Trend Continuation
        // 1 if the next candle moves in the same direction as the EMA200 trend
        const ema200v = ema200[i - (prices.length - ema200.length)] ?? current.close;
        const emaBullish = current.close > ema200v;
        const nextBullish = nextCandle.close > nextCandle.open;
        const isContinuation = (emaBullish === nextBullish) ? 1 : 0;

        // Target 3: Reversal Probability
        // 1 if the next candle reverses the short-term 3-candle momentum
        const prev3Close = slice[Math.max(0, slice.length - 4)]?.close ?? current.close;
        const localMomentumBullish = current.close > prev3Close;
        const isReversal = (localMomentumBullish !== nextBullish) ? 1 : 0;

        // Indicators at index i
        const rsiIdx   = i - (prices.length - rsiArr.length);
        const macdIdx  = i - (prices.length - macdArr.length);
        const atrIdx   = i - (prices.length - atrArr.length);
        const ema200Idx = i - (prices.length - ema200.length);

        const rsi     = rsiArr[rsiIdx]  ?? 50;
        const macdHist = macdArr[macdIdx]?.histogram ?? 0;
        const atrPct  = current.close > 0 ? atrVal / current.close : 0;
        const emaTrend = current.close > ema200v ? 1 : 0;

        // Volume spike
        const last20  = slice.slice(-20);
        const avgVol  = last20.reduce((s, c) => s + c.volume, 0) / 20;
        const volSpike = current.volume > avgVol * 1.5 ? 1 : 0;

        // Market regime & session
        const regime  = regimeEnc[detectMarketRegime(slice)] ?? 0;
        const session = sessionEnc[getSession(current.time)] ?? 0.5;

        // Liquidity sweep
        const sweep   = detectLiquiditySweep(slice);
        const sweepVal = sweep ? (sweep.direction === 'BULLISH' ? 1 : -1) : 0;

        // BOS
        const bos = detectBOS(slice, 10);
        const bosVal = bosEnc[bos.bos] ?? 0;

        // Orderflow delta
        const flow = calculateOrderflow(slice, 20);
        const deltaRatio = flow.deltaRatio;

        // Liquidity clusters
        const clusters = detectLiquidityClusters(slice);
        const clusterScore = (clusters.score - 50) / 50; // normalize to -1..+1

        // Placeholder for orderbook / whale (not available in historical data)
        const obImbalance = 0;
        const whaleDom = 0;

        rows.push([
            current.close, rsi, macdHist, volSpike,
            atrPct, emaTrend, obImbalance,
            sweepVal, regime, session,
            bosVal, whaleDom, deltaRatio, clusterScore,
            isBreakout, isContinuation, isReversal
        ].map(v => parseFloat(v).toFixed(6)).join(','));
    }

    console.log(`[DataGen] ${symbol} ${timeframe}: ${rows.length} rows generated`);
    return rows;
}

async function main() {
    console.log('\n══════════════════════════════════════════');
    console.log('  TREADING AI — Training Data Generator');
    console.log('══════════════════════════════════════════\n');

    // Write header
    writeFileSync(OUTPUT_PATH, HEADER + '\n');

    let totalRows = 0;

    for (const symbol of SYMBOLS) {
        for (const tf of TIMEFRAMES) {
            try {
                const rows = await generateForSymbol(symbol, tf);
                if (rows.length > 0) {
                    appendFileSync(OUTPUT_PATH, rows.join('\n') + '\n');
                    totalRows += rows.length;
                }
                // Rate limit pause
                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                console.error(`[DataGen] Error for ${symbol} ${tf}:`, err.message);
            }
        }
    }

    console.log(`\n✅ Done! ${totalRows} rows written to:`);
    console.log(`   ${OUTPUT_PATH}`);
    console.log('\nNext step: python ml/train_model.py\n');
}

main().catch(console.error);
