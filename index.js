const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const path = require('path');

const TELEGRAM_BOT_TOKEN = '7072846342:AAHC3ViEXWKkOB3jkL_1hOGruymarLXYYew';
const TELEGRAM_CHAT_ID = '@TCWAlerts';

const ALERTS_FILE = './alerts.json';
const BUFFER = 0.0025;

function loadAlerts() {
  const raw = fs.readFileSync(ALERTS_FILE);
  return JSON.parse(raw);
}

function saveAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
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

ws.on('message', (data) => {
  const parsed = JSON.parse(data);
  const tickers = parsed.data;
  let alerts = loadAlerts();
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
      const tagText = alert.message ? alert.message : 'deviation';
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
  // Remove only alerts that were triggered (by id)
  if (triggeredAlertIds.length > 0) {
    alerts = alerts.filter(alert => !triggeredAlertIds.includes(alert.id));
    saveAlerts(alerts);
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

function readAlerts() {
  if (!fs.existsSync(ALERTS_FILE_PATH)) return [];
  const data = fs.readFileSync(ALERTS_FILE_PATH, 'utf-8');
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE_PATH, JSON.stringify(alerts, null, 2));
}

app.get('/alerts', (req, res) => {
  const alerts = readAlerts();
  res.json(alerts);
});

app.post('/alerts', (req, res) => {
  const alert = req.body;
  if (!alert.symbol || !alert.side || !alert.entryPrice || !alert.signalTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // Always generate a unique id for the alert (even if UI does not send it)
  alert.id = `${alert.symbol}_${alert.entryPrice}_${Date.now()}`;
  const alerts = readAlerts();
  alerts.push(alert);
  writeAlerts(alerts);
  res.status(201).json({ success: true, id: alert.id });
});

app.post('/alerts-overwrite', (req, res) => {
  const alerts = req.body;
  if (!Array.isArray(alerts)) return res.status(400).json({ error: 'Invalid data' });
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Alert API running on http://localhost:${PORT}`);
});

(async () => {
  const isLong = true;
  const color = isLong ? '🟩' : '🟥';
  const typeText = isLong ? 'Long' : 'Short';
  const symbol = 'BTCUSDT';
  const entryPrice = 67000;
  const cmp = 67200;
  const tagText = 'Check deviation strategy call before taking trade';
  const message = `${color} <b><u>ALERT</u></b>\n\n` +
    `<b>Coin:</b> <code>${symbol}</code>\n` +
    `<b>Type:</b> <b>${typeText}</b>\n` +
    `<b>Entry price:</b> <code>${entryPrice}</code>\n` +
    `<b>CMP:</b> <code>${cmp}</code>\n` +
    `<b>Tag:</b> <i>${tagText}</i>\n` +
    `\n<a href='https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}'>📈 View Chart</a>`;
  await sendTelegramMessage(message, 'HTML');
})();
