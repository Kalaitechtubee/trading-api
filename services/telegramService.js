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
        stopLoss, target, timeframe, strengthLabel
    } = signal;

    const targetType = signal.targetType || 'Structure';
    const institutional = signal.institutional || {};
    const premiumLabel = signal.premiumLabel || '🛡️ ELITE';
    const strengthEmoji = score >= 82 ? '💎' : '🔥';
    const signalEmoji = action === 'BUY' ? '🟢' : '🔴';

    const regime = institutional.regime || 'Unknown';
    const session = institutional.session || 'Unknown';
    const vwapBias = institutional.vwapBias || 'Neutral';
    const orderbookLabel = institutional.orderbook?.label || 'Neutral';
    const breakoutProb = institutional.breakoutProb || 0;
    const mtfConfirmation = signal.mtfConfirmation ? `\n✅ MTF Confirmed: <b>${signal.mtfConfirmation}</b>` : '';

    const formattedPrice = `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
    const formattedSL = `$${Number(stopLoss).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
    const formattedTP = `$${Number(target).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;

    const message = `
${strengthEmoji} <b>TREADING AI — ${premiumLabel}</b>

🎯 Symbol: <b>${symbol.toUpperCase()}</b>
${signalEmoji} Direction: <b>${action.toUpperCase()}</b>
🔥 Score: <b>${score}%</b>
💪 Strength: <b>${strengthLabel}</b>

💰 Entry:   <b>${formattedPrice}</b>
🛡️ Stop Loss: <b>${formattedSL}</b>
🏁 Target:  <b>${formattedTP}</b>

📍 Target Type: <i>${targetType || 'Structure'}</i>
📈 Breakout Prob: <b>${breakoutProb}%</b>
🌊 VWAP Bias: <b>${vwapBias}</b>
📊 Orderbook: <b>${orderbookLabel}</b>
🗺️ Regime: <b>${regime}</b>
⏰ Session: <b>${session}</b>${mtfConfirmation}

⏱ Timeframe: <i>${timeframe}</i>
🤖 <i>Elite Algorithmic Scanner v2.0</i>
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
