/**
 * TREADING AI — Telegram Alert Service (Backend)
 * Sends institutional-grade styled alert messages to Telegram.
 * Token & Chat ID are loaded from environment variables.
 */

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT;

/**
 * Send a raw text message to Telegram
 * @param {string} text - HTML-formatted message
 */
export async function sendMessage(text) {
    if (!TOKEN || !CHAT_ID) {
        console.warn('[TelegramService] TELEGRAM_TOKEN or TELEGRAM_CHAT not set. Skipping.');
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text,
            parse_mode: 'HTML'
        }, { timeout: 10000 });
    } catch (err) {
        console.error('[TelegramService] Failed to send message:', err.message);
    }
}

/**
 * Send a formatted trading signal alert
 *
 * @param {Object} signal - The full signal object from the scanner
 */
export async function sendSignalAlert(signal) {
    if (!TOKEN || !CHAT_ID) {
        console.warn('[TelegramService] Token not configured. Skipping alert.');
        return;
    }

    const {
        symbol, action, score, price,
        stopLoss, target, target2, riskReward, timeframe, strengthLabel,
        timestamp, expiresAt
    } = signal;

    const targetType = signal.targetType || 'Structure';
    const institutional = signal.institutional || {};
    const premiumLabel = signal.premiumLabel || '🛡️ ELITE';
    const strengthEmoji = score >= 82 ? '💎' : '🚀';
    const signalEmoji = action === 'BUY' ? '🟢' : '🔴';

    const regime = institutional.regime || 'Unknown';
    const session = institutional.session || 'Unknown';
    const vwapBias = institutional.vwapBias || 'Neutral';
    const orderbookLabel = institutional.orderbook?.label || 'Neutral';
    const breakoutProb = institutional.breakoutProb || 0;
    const roadmap = signal.mtfRoadmap;

    // MTF Confirmation text
    const mtfConfirmed = roadmap ? 'YES' : 'NO';
    const mtfDetails = roadmap ?
        `\n• 4H: <b>${roadmap.h4}</b> | 1H: <b>${roadmap.h1}</b> | 15M: <b>${roadmap.m15}</b>` : '';

    // Date & Time formatting
    const signalDate = new Date(timestamp || Date.now());
    const dateStr = signalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = signalDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';

    // Pricing formatting (Smart decimals)
    const formatPrice = (p) => {
        const num = Number(p);
        return num.toLocaleString('en-US', {
            minimumFractionDigits: num < 1 ? 4 : 2,
            maximumFractionDigits: num < 1 ? 8 : 2
        });
    };

    const formattedPrice = formatPrice(price);
    const formattedSL = formatPrice(stopLoss);
    const formattedTP1 = formatPrice(target);
    const formattedTP2 = formatPrice(target2);

    // Potential Profit calculation
    const potentialProfit = Math.abs(target - price).toLocaleString('en-US', {
        minimumFractionDigits: price < 1 ? 4 : 2,
        maximumFractionDigits: price < 1 ? 8 : 2
    });

    const message = `
${strengthEmoji} <b>TREADING AI — ${premiumLabel} SIGNAL</b>

🪙 Symbol: <b>${symbol.toUpperCase()}</b>
📊 Direction: <b>${action.toUpperCase()}</b>
🔥 Confidence: <b>${score}%</b>

💰 Entry Price: <b>${formattedPrice}</b>
🎯 Target 1: <b>${formattedTP1}</b>
🎯 Target 2: <b>${formattedTP2}</b>

🛡 Stop Loss: <b>${formattedSL}</b>
💵 Potential Profit: <b>+${potentialProfit}</b>

📈 Risk/Reward: <b>${riskReward}</b>

⏰ Timeframe: <b>${timeframe}</b>
🧠 MTF Confirmation: <b>${mtfConfirmed}</b>${mtfDetails}

📅 Date: <b>${dateStr}</b>
🕒 Time: <b>${timeStr}</b>

⚡ Valid for: <b>15 minutes</b>
📍 Target Type: <i>${targetType}</i>
🌊 Bias: <i>${vwapBias}</i> | 🗺️ Regime: <i>${regime}</i>
🤖 <i>Elite Algorithmic Scanner v2.1</i>
`;

    await sendMessage(message);
}

/**
 * Send a summary of the top N signals
 * @param {Array} signals
 */
export async function sendTopSignalsSummary(signals) {
    if (!signals || signals.length === 0) return;

    const header = `🔥 <b>Top Signals — Treading AI Backend</b>\n\n`;
    const body = signals
        .slice(0, 5)
        .map((s, i) =>
            `${i + 1}️⃣ <b>${s.symbol}</b> ${s.action.includes('BUY') ? '🟢' : '🔴'} ${s.action} — <b>${s.score}%</b>\nPrice: ${s.price} | Target: ${s.target?.toFixed(4)}`
        )
        .join('\n\n');

    const footer = `\n\n🚀 <i>Treading AI Auto-Scanner</i>`;
    await sendMessage(header + body + footer);
}
