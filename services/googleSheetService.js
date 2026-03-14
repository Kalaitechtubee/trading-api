import axios from 'axios';

// ── Hardcoded Config (no .env needed) ────────────────────────
const SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxdDAlPcL_rt6slSNMp-PYkq1w2AP6jpHf3KHOZxHnCvj1XomdEwQDfCHMArymHEly-Ig/exec';

/**
 * Send trade signal data to Google Sheets via Apps Script Webhook
 * @param {Object} signal - The signal object from marketScanner
 */
export async function sendToSheet(signal) {
    if (!SHEET_WEBHOOK || SHEET_WEBHOOK.includes('AKfycbxxxxxxxx')) {
        // Silently skip if webhook is not configured
        return;
    }

    try {
        await axios.post(SHEET_WEBHOOK, {
            symbol: signal.symbol,
            side: signal.action,      // 'BUY' or 'SELL'
            tf: signal.timeframe,     // Matches 'TF' column
            entry: signal.price,
            tp: signal.target,        // Fix: was signal.tp, should be signal.target
            sl: signal.stopLoss,      // Fix: was signal.sl, should be signal.stopLoss
            confidence: `${signal.score}%`,
            grade: signal.grade?.grade || 'C'
        });

        console.log(`[GoogleSheet] 📊 Logged ${signal.symbol} signal to Google Sheets`);
    } catch (err) {
        console.error(`[GoogleSheet] ❌ Error logging to sheet:`, err.message);
    }
}
