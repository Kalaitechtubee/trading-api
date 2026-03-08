import { sendSignalAlert } from '../services/telegramService.js';

async function testBot() {
    console.log('Sending test signal to Telegram...');

    const testSignal = {
        symbol: 'TESTUSDT',
        action: 'BUY',
        score: 95,
        price: 50.00,
        stopLoss: 48.00,
        target: 52.00,
        target2: 55.00,
        riskReward: '1:4',
        timeframe: '15m',
        strengthLabel: '🛡️ ELITE (TEST)',
        timestamp: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        premiumLabel: '👑 PREMIUM (TEST)',
        targetType: 'Resistance Jump',
        institutional: {
            regime: 'Trending',
            session: 'New York',
            vwapBias: 'Bullish',
            orderbook: { label: 'Aggressive Bids' },
            breakoutProb: 88
        },
        mtfRoadmap: {
            h4: 'Bullish',
            h1: 'Bullish',
            m15: 'Bullish'
        }
    };

    try {
        await sendSignalAlert(testSignal);
        console.log('✅ Test signal sent! Please check your Telegram bot.');
    } catch (err) {
        console.error('❌ Failed to send test signal:', err.message);
    }
}

testBot();
