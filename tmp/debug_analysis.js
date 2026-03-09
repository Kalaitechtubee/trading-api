/**
 * Debug script: Fetch 300 real candles from Binance and run analysis
 * This will show us exactly what scores are being produced per module
 */
import { getCandles } from '../services/binanceService.js';
import { runAIAnalysis } from '../scanner/technical.js';

async function debug() {
    console.log('Fetching 300 candles for BTCUSDT 15m...\n');
    const candles = await getCandles('BTCUSDT', '15m', 300);

    if (!candles || candles.length === 0) {
        console.error('❌ Failed to fetch candles');
        return;
    }

    console.log(`✅ Got ${candles.length} candles`);
    console.log(`   First: ${new Date(candles[0].time * 1000).toISOString()}`);
    console.log(`   Last:  ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);
    console.log(`   Price: $${candles[candles.length - 1].close}\n`);

    const result = runAIAnalysis(candles, '15m', 'BTCUSDT', null);

    if (result.error) {
        console.error('❌ Analysis error:', result.error);
        return;
    }

    console.log('═══ ANALYSIS RESULT ═══');
    console.log(`Action:       ${result.action}`);
    console.log(`Score:        ${result.score}%`);
    console.log(`Bias:         ${result.bias}`);
    console.log(`Strength:     ${result.strengthLabel}`);
    console.log(`\n── Module Scores ──`);
    console.log(`Market Struct: ${result.strategyScores.marketStructure}%`);
    console.log(`S/R:           ${result.strategyScores.sr}%`);
    console.log(`Momentum:      ${result.strategyScores.momentum}%`);
    console.log(`Volume Flow:   ${result.strategyScores.volumeFlow}%`);
    console.log(`Liq Zones:     ${result.strategyScores.liquidityZones}%`);
    console.log(`Volatility:    ${result.strategyScores.volatility}%`);
    console.log(`VWAP Bias:     ${result.strategyScores.vwapBias}%`);
    console.log(`Orderbook:     ${result.strategyScores.orderbook}%`);
    console.log(`\n── Direction Scores ──`);
    console.log(`Bullish Score: ${result.strategyScores.bullishScore}%`);
    console.log(`Bearish Score: ${result.strategyScores.bearishScore}%`);
    console.log(`\n── Filters ──`);
    console.log(`isVolumeSpike: ${result.isVolumeSpike}`);
    console.log(`Factors:       ${result.factors.join(', ') || 'none'}`);
    console.log(`Patterns:      ${result.patterns || 'none'}`);
    console.log(`RSI:           ${result.currentRSI}`);
}

debug().catch(console.error);
