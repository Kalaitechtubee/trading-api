# 🎯 Treading AI — Technical Documentation

## 1. Project Overview
Treading AI is a high-frequency market scanning engine designed to identify institutional-grade trading opportunities. It combines advanced technical analysis with Smart Money Concepts (SMC) and machine learning to filter out market noise and provide accurate signals.

---

## 2. Core Architecture
The system operates on a multi-layered analysis pipeline:

### A. Data Acquisition Layer
- **Binance Futures API**: Fetches real-time OHLCV data, orderbook depth, and futures metrics (Open Interest, Funding Rates).
- **Forex Engine**: Standardized scanning of key currency pairs via the scanner's logic.
- **Delta Exchange Sync**: Cross-references symbols to ensure only tradeable assets on Delta are scanned.

### B. Signal Generation Engine (`scanner/technical.js`)
The "Brain" of the scanner uses a weighted scoring model (0-100%).
- **Smart Money Concepts (SMC)**: 
  - **BOS/CHoCH**: Detects breaks in market structure.
  - **Order Blocks (OB)**: Identifies institutional supply and demand zones.
  - **Liquidity Sweeps**: Recognizes retail stop-hunts.
- **Technical Indicators**: Optimized EMA200, VWAP, RSI, MACD, and ADX filters.
- **Candle Patterns**: Real-time identification of Engulfing, Hammers, and Dojis.

### C. Multi-Timeframe (MTF) Alignment
To eliminate "fake" signals, the scanner enforces a **Strict 4-TF Confluence** rule:
- A signal is ONLY dispatched if the **5m, 15m, 1h, and 4h** timeframes all agree on the direction and meet the minimum score threshold.

### D. Machine Learning Layer (`services/nodeMLService.js`)
- **Engine**: Integrated `ml-random-forest` running natively in Node.js.
- **Role**: Provides a final confidence boost (±8 pts) based on historical patterns of the specific asset.

---

## 3. Storage & Persistence (`memory/`)
The system uses a highly optimized **JSON-based storage** model to avoid the latency of traditional databases:
- `trades.json`: Stores all generated signals for real-time backtesting.
- `signals.json`: Temporary storage for current active signals.
- `backtestStore.js`: Handles automated monitoring of signals to calculate win rates.

---

## 4. Operational Workflow

### Daily Cycle
1. **00:00 - 23:00**: Autonomous 24/7 scanning.
2. **23:00 IST**: Automation trigger for the **Daily Performance Report**.
3. **Continuous**: Symbol rotation to focus on high-volume assets.

### Training the AI
If you wish to update the ML model with the latest market data:
1. Run `node scripts/generateTrainingData.js`.
2. Run `node train_node_ml.js`.
3. The server hot-reloads the new model automatically.

---

## 5. Console Guide
- **Magnifying Glass (🔍)**: Active scan in progress.
- **Fire (🔥)**: Momentum detected on a specific timeframe.
- **Target (🎯)**: FULL 4-TF Confluence achieved! Signal dispatched to Telegram.

---

## 6. Security & Stability
- **Redis Caching**: Prevents API rate limits and reduces response times.
- **Health Checks**: API endpoint available at `/health` for uptime monitoring.
- **Graceful Shutdown**: Handles SIGINT signals to save data before closing.

---
*Developed by Antigravity for Treading AI — v1.0 Ready.*
