/**
 * TREADING AI — Risk & Trade Management Configuration
 */
export default {
    // Stop Loss Settings
    atrMultiplierSL: 1.5,      // SL = Price +/- (ATR * 1.5)
    
    // Take Profit Settings
    target1RR: 2.0,            // TP1 = Entry + (Risk * 2)
    target2RR: 3.0,            // TP2 = Entry + (Risk * 3)
    
    // Trade Expiry
    scalpingExpiryMs: 15 * 60 * 1000,    // 15 minutes for 5m/15m signals
    intradayExpiryMs: 4 * 60 * 60 * 1000, // 4 hours for 1h signals
    swingExpiryMs: 24 * 60 * 60 * 1000,   // 24 hours for 4h signals
    
    // Filter Settings
    minAtrPct: 0.015,          // 1.5% minimum volatility required for breakout
    wickRejectionBuy: 2.0,     // Reject BUY if upper wick > body * 2
    wickRejectionSell: 2.5,    // Reject SELL if lower wick > body * 2.5
    
    // Confluence Settings
    minConfluenceFactors: 2    // Minimum number of supporting factors if score is low
};
