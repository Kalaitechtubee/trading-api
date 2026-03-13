import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RandomForestClassifier } from 'ml-random-forest';
import Papa from 'papaparse';

import mlConfig from '../config/mlConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(__dirname, '..', 'ml_node');

// Feature order must be consistent
export const FEATURE_COLUMNS = mlConfig.featureColumns;

class NodeMLService {
    constructor() {
        this.models = {
            breakout: null,
            continuation: null,
            reversal: null
        };
        this.metadata = null;
        this.isLoaded = false;
        
        // Ensure directory exists
        if (!fs.existsSync(MODEL_DIR)) {
            fs.mkdirSync(MODEL_DIR, { recursive: true });
        }
    }

    /**
     * Load models from disk
     */
    async loadModels() {
        try {
            const metaPath = path.join(MODEL_DIR, 'model_meta.json');
            if (!fs.existsSync(metaPath)) {
                console.log('[NodeML] ⚠️ No local model found. Training required.');
                return false;
            }

            this.metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            
            for (const type of ['breakout', 'continuation', 'reversal']) {
                const modelPath = path.join(MODEL_DIR, `model_${type}.json`);
                if (fs.existsSync(modelPath)) {
                    const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
                    this.models[type] = RandomForestClassifier.load(modelData);
                }
            }

            this.isLoaded = !!(this.models.breakout && this.models.continuation && this.models.reversal);
            if (this.isLoaded) {
                console.log(`[NodeML] ✅ Loaded models (v${this.metadata.version}) - Acc: ${(this.metadata.accuracy_avg * 100).toFixed(2)}%`);
            }
            return this.isLoaded;
        } catch (err) {
            console.error('[NodeML] ❌ Error loading models:', err.message);
            return false;
        }
    }

    /**
     * Save models to disk
     */
    saveModels(metadata) {
        try {
            for (const [type, model] of Object.entries(this.models)) {
                if (model) {
                    const modelPath = path.join(MODEL_DIR, `model_${type}.json`);
                    fs.writeFileSync(modelPath, JSON.stringify(model.toJSON()));
                }
            }

            const metaPath = path.join(MODEL_DIR, 'model_meta.json');
            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
            this.metadata = metadata;
            this.isLoaded = true;
            console.log(`[NodeML] 💾 Models saved to ${MODEL_DIR}`);
        } catch (err) {
            console.error('[NodeML] ❌ Error saving models:', err.message);
        }
    }

    /**
     * Train models using local CSV data
     */
    async train(csvPath) {
        console.log(`[NodeML] 🚀 Starting training from ${csvPath}...`);
        
        const fileContent = fs.readFileSync(csvPath, 'utf8');
        const { data } = Papa.parse(fileContent, { header: true, dynamicTyping: true, skipEmptyLines: true });
        
        // Clean data: drop rows with missing featured or targets
        const cleanData = data.filter(row => 
            FEATURE_COLUMNS.every(f => row[f] !== null && row[f] !== undefined) &&
            ['target_breakout', 'target_continuation', 'target_reversal'].every(t => row[t] !== null && row[t] !== undefined)
        );

        if (cleanData.length < 100) {
            throw new Error(`Insufficient data for training: ${cleanData.length} valid samples (need 100+)`);
        }

        // Limit to most recent samples for speed (Trading data favors recency)
        const trainData = cleanData.length > mlConfig.trainSampleLimit 
            ? cleanData.slice(-mlConfig.trainSampleLimit) 
            : cleanData;
        console.log(`[NodeML] 📊 Using ${trainData.length} samples for training.`);

        // Prepare inputs and outputs
        const X = trainData.map(row => FEATURE_COLUMNS.map(f => Number(row[f])));
        const y_b = trainData.map(row => Number(row.target_breakout));
        const y_c = trainData.map(row => Number(row.target_continuation));
        const y_r = trainData.map(row => Number(row.target_reversal));

        const options = {
            seed: 42,
            nEstimators: mlConfig.nEstimators,
            maxDepth: mlConfig.maxDepth,
            replacement: true,
            useSampleFeatures: true
        };

        console.log('[NodeML] 🔧 Training Breakout model...');
        this.models.breakout = new RandomForestClassifier(options);
        this.models.breakout.train(X, y_b);

        console.log('[NodeML] 🔧 Training Continuation model...');
        this.models.continuation = new RandomForestClassifier(options);
        this.models.continuation.train(X, y_c);

        console.log('[NodeML] 🔧 Training Reversal model...');
        this.models.reversal = new RandomForestClassifier(options);
        this.models.reversal.train(X, y_r);

        // Simple validation on training data (not ideal, but enough for POC)
        const acc_b = this.calculateAccuracy(this.models.breakout, X, y_b);
        const acc_c = this.calculateAccuracy(this.models.continuation, X, y_c);
        const acc_r = this.calculateAccuracy(this.models.reversal, X, y_r);
        const avg_acc = (acc_b + acc_c + acc_r) / 3;

        const metadata = {
            version: 'node-v1.0',
            accuracy_avg: avg_acc,
            trained_at: new Date().toISOString(),
            n_samples: cleanData.length,
            features: FEATURE_COLUMNS
        };

        this.saveModels(metadata);
        return metadata;
    }

    calculateAccuracy(model, X, y) {
        const predictions = model.predict(X);
        let correct = 0;
        for (let i = 0; i < y.length; i++) {
            if (predictions[i] === y[i]) correct++;
        }
        return correct / y.length;
    }

    /**
     * Prediction
     */
    async predict(features) {
        if (!this.isLoaded) {
            // Lazy load if training recently finished
            const loaded = await this.loadModels();
            if (!loaded) return null;
        }

        const featureVector = [FEATURE_COLUMNS.map(f => features[f])];
        
        try {
            // ml-random-forest predictProbability returns array of objects like [{ '0': 0.2, '1': 0.8 }]
            const prob_b = this.models.breakout.predictProbability(featureVector)[0];
            const prob_c = this.models.continuation.predictProbability(featureVector)[0];
            const prob_r = this.models.reversal.predictProbability(featureVector)[0];

            // In our binary targets, '1' is the probability we want
            const buyProb = (prob_b['1'] || 0) * 0.5 + (prob_c['1'] || 0) * 0.5; // Average of breakout and continuation
            const sellProb = (prob_r['1'] || 0); // Reversal usually indicates opposite of current trend
            
            // Re-mapping for the API format
            // In the Python version: 
            // buy_probability = (prob_breakout + prob_continuation) / 2
            // sell_probability = prob_reversal (if current bias is bearish) or similar logic
            // Let's keep it simple for now to match the frontend expectation
            
            return {
                buyProbability: buyProb * 100,
                sellProbability: sellProb * 100,
                confidence: Math.max(buyProb, sellProb) * 100,
                available: true,
                source: 'local_node'
            };
        } catch (err) {
            console.error('[NodeML] ❌ Prediction error:', err.message);
            return null;
        }
    }
}

export const nodeMLService = new NodeMLService();
