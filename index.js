const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const serviceAccount = require('./crypto-alerts-39a61-firebase-adminsdk-fbsvc-112fbc90b7.json'); // Downloaded from Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const ALERTS_COLLECTION = 'alerts';

const TELEGRAM_BOT_TOKEN = '7072846342:AAHC3ViEXWKkOB3jkL_1hOGruymarLXYYew';
const TELEGRAM_CHAT_ID = '@kaushikAlert';

const BUFFER = 0.0025;

async function loadAlerts() {
  const snapshot = await db.collection(ALERTS_COLLECTION).get();
  return snapshot.docs.map(doc => doc.data());
}

async function saveAlerts(alerts) {
  // Overwrite all alerts (used for /alerts-overwrite)
  const batch = db.batch();
  const ref = db.collection(ALERTS_COLLECTION);
  const existing = await ref.get();
  existing.forEach(doc => batch.delete(doc.ref));
  alerts.forEach(alert => {
    batch.set(ref.doc(alert.id), alert);
  });
  await batch.commit();
}

async function addAlert(alert) {
  await db.collection(ALERTS_COLLECTION).doc(alert.id).set(alert);
}

async function deleteAlertsByIds(ids) {
  const batch = db.batch();
  ids.forEach(id => {
    const ref = db.collection(ALERTS_COLLECTION).doc(id);
    batch.delete(ref);
  });
  await batch.commit();
}

async function sendTelegramMessage(text, parseMode = 'Markdown') {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: false
    });
    console.log('Telegram alert sent:', text);
  } catch (error) {
    console.error('Telegram send error:', error.message);
  }
}

const ws = new WebSocket('wss://fstream.binance.com/stream?streams=!miniTicker@arr');

ws.on('open', () => {
  console.log('Connected to Binance Perps WebSocket');
});

ws.on('message', async (data) => {
  const parsed = JSON.parse(data);
  const tickers = parsed.data;
  let alerts = await loadAlerts();
  if (alerts.length === 0) return;
  let triggeredAlertIds = [];
  alerts.forEach((alert) => {
    const ticker = tickers.find(t => t.s === alert.symbol);
    if (!ticker) return;
    const price = parseFloat(ticker.c);
    const lowerBound = alert.entryPrice * (1 - BUFFER);
    const upperBound = alert.entryPrice * (1 + BUFFER);
    if (price >= lowerBound && price <= upperBound) {
      const isLong = alert.side.toLowerCase() === 'long';
      const color = isLong ? '🟩' : '🟥';
      const typeText = isLong ? 'Long' : 'Short';
      const tagText = alert.tag ? alert.tag : 'deviation';
      const message = `${color} <b><u>ALERT</u></b>\n\n` +
        `<b>Coin:</b> <code>${alert.symbol}</code>\n` +
        `<b>Type:</b> <b>${typeText}</b>\n` +
        `<b>Entry price:</b> <code>${alert.entryPrice}</code>\n` +
        `<b>CMP:</b> <code>${price}</code>\n` +
        `<b>Tag:</b> <i>${tagText}</i>\n` +
        `\n<a href='https://www.tradingview.com/chart/?symbol=BINANCE:${alert.symbol}'>📈 View Chart</a>`;
      sendTelegramMessage(message, 'HTML');
      console.log('Alert triggered:', message);
      if (alert.id) triggeredAlertIds.push(alert.id);
    }
  });
  if (triggeredAlertIds.length > 0) {
    await deleteAlertsByIds(triggeredAlertIds);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('WebSocket closed. Reconnecting...');
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

const app = express();
const PORT = 3000;
const ALERTS_FILE_PATH = path.join(__dirname, 'alerts.json');

app.use(cors());
app.use(express.json());

app.get('/alerts', async (req, res) => {
  const alerts = await loadAlerts();
  res.json(alerts);
});

app.post('/alerts', async (req, res) => {
  const alert = req.body;
  if (!alert.symbol || !alert.side || !alert.entryPrice || !alert.signalTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  alert.id = `${alert.symbol}_${alert.entryPrice}_${Date.now()}`;
  await addAlert(alert);
  res.status(201).json({ success: true, id: alert.id });
});

app.post('/alerts-overwrite', async (req, res) => {
  const alerts = req.body;
  if (!Array.isArray(alerts)) return res.status(400).json({ error: 'Invalid data' });
  await saveAlerts(alerts);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Alert API running on http://localhost:${PORT}`);
});

// Removed IIFE that added a test alert and sent a Telegram message on startup for production readiness.
