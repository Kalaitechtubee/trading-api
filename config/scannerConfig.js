/**
 * TREADING AI — Scanner Configuration
 */
export default {
    // Scoring Thresholds
    minScoreToAlert: 70,           // Score >= 70 triggers signal
    premiumSignalThreshold: 82,    // Score >= 82 gets 👑 PREMIUM tag
    minScoreToStore: 60,           // Score >= 60 stored in history
    
    // Core Scan Logic
    scanIntervalMs: 180000,        // 3 minutes recommended
    forexScanInterval: 5,          // Scan forex every 5 crypto scans
    alertCooldownMs: 10 * 60 * 1000, // 10 minutes between signals for same symbol/TF
    
    // Default Symbols (Scanned if dynamic symbols fail)
    defaultCryptoSymbols: [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
        'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'POLUSDT',
        'SUIUSDT', 'APTUSDT', 'NEARUSDT'
    ],
    
    forexSymbols: [
        "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", 
        "USD/CHF", "NZD/USD", "EUR/JPY", "GBP/JPY"
    ],
    
    // Timeframes to scan
    timeframes: ['5m', '15m', '1h', '4h'],
    
    // Logging/Debug
    debugSignals: true,
    showDetailedScanProgress: true
};
