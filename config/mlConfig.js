/**
 * TREADING AI — Machine Learning Configuration
 */
export default {
    // Model Architecture
    engine: 'node', // 'node' (local) or 'python' (legacy Flask)
    
    // Training Hyperparameters
    nEstimators: 50,
    maxDepth: 8,
    trainSampleLimit: 3000,
    minSamplesForTraining: 100,
    
    // Feature Columns (Must match technical indicator encoders)
    featureColumns: [
        'price', 
        'rsi', 
        'macd_histogram', 
        'volume_spike',
        'atr_pct', 
        'ema_trend', 
        'orderbook_imbalance',
        'liquidity_sweep', 
        'regime', 
        'session',
        'bos', 
        'whale_dominance', 
        'delta_ratio', 
        'cluster_score'
    ],
    
    // Confidence Thresholds
    mlBonusWeight: 8,       // Points added to total score if ML confirms
    mlConfidenceThreshold: 70 // Minimum probability to consider ML confirmed
};
