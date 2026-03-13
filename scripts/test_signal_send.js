/**
 * TREADING AI — Test Signal Sender
 * Run: node scripts/test_signal_send.js
 * Purpose: Verifies Telegram signal delivery is working correctly.
 */

import dotenv from 'dotenv';
import { sendMessage, sendSignalAlert } from '../services/telegramService.js';

dotenv.config();

// ── Test 1: Plain Message ─────────────────────────────────────
async function testPlainMessage() {
    console.log('\n[Test 1] Sending plain message...');
    await sendMessage(`
🧪 <b>TREADING AI — Test Message</b>

✅ Telegram connection is working!
🕒 Time: <b>${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</b>
🤖 <i>Sent by test_signal_send.js</i>
    `.trim());
    console.log('[Test 1] ✅ Plain message sent!');
}

// ── Test 2: Full Signal Alert ─────────────────────────────────
async function testSignalAlert() {
    console.log('\n[Test 2] Sending mock signal alert...');

    const mockSignal = {
        symbol: 'BTCUSDT',
        action: 'BUY',
        score: 87,
        price: 65432.10,
        stopLoss: 64800.00,
        target: 66500.00,
        target2: 67200.00,
        riskReward: '1:2.0',
        timeframe: '15m',
        strengthLabel: 'Strong',
        timestamp: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        marketType: 'Crypto',
        premiumLabel: '👑 PREMIUM',
        targetType: 'Structure',
        isElite: true,
        mtfRoadmap: { h1: 'Bullish', m15: 'Bullish', m5: 'Bullish' },
        institutional: {
            regime: 'Trending',
            session: 'London',
            vwapBias: 'Bullish',
            breakoutProb: 78,
            orderbook: { label: 'Buy Wall' }
        }
    };

    await sendSignalAlert(mockSignal);
    console.log('[Test 2] ✅ Signal alert sent!');
}

// ── Run All Tests ─────────────────────────────────────────────
(async () => {
    console.log('═══════════════════════════════════════════');
    console.log('       TREADING AI — Signal Send Test');
    console.log('═══════════════════════════════════════════');
    console.log(`Telegram Token : ${process.env.TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`Telegram Chat  : ${process.env.TELEGRAM_CHAT  ? '✅ Set' : '❌ Missing'}`);
    console.log('═══════════════════════════════════════════');

    if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT) {
        console.error('\n❌ TELEGRAM_TOKEN or TELEGRAM_CHAT is not set in .env');
        console.error('   Please check your .env file and restart.');
        process.exit(1);
    }

    try {
        await testPlainMessage();
        await testSignalAlert();

        console.log('\n✅ All tests passed! Check your Telegram for messages.');
    } catch (err) {
        console.error('\n❌ Test failed:', err.message);
        process.exit(1);
    }
})();
