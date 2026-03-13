/**
 * CLI Script to train the Node.js ML model
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { nodeMLService } from './services/nodeMLService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, 'ml', 'training_data.csv');

async function runTraining() {
    try {
        console.log('--- Node.js ML Training Tool ---');
        const meta = await nodeMLService.train(CSV_PATH);
        console.log('✅ Training complete!');
        console.log(JSON.stringify(meta, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('❌ Training failed:', err.message);
        process.exit(1);
    }
}

runTraining();
