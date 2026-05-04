const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
// ─── VERIFY SIGNATURE ALGORITHM WITH DOCS EXAMPLE ──────────────────────

const BASE_URL = process.env.XBET_API_URL?.trim();
const HASH = process.env.XBET_HASH?.trim();
const CASHIER_PASS = process.env.XBET_CASHIER_PASS?.trim();
const CASHDESK_ID = process.env.XBET_CASHDESK_ID?.trim();
const LNG = 'ru';

// ─── Helper functions ─────────────────────────────────────────────────────

const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');
const md5 = (str) => crypto.createHash('md5').update(str).digest('hex');

const getDateTime = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
};

// ─── 1. Get cashdesk balance ──────────────────────────────────────────────
const getCashdeskBalance = async () => {
  try {
    const dt = getDateTime();

    // Build signature
    const part1 = sha256(`hash=${HASH}&cashierpass=${CASHIER_PASS}&dt=${dt}`);
    const part2 = md5(`dt=${dt}&cashierpass=${CASHIER_PASS}&cashdeskid=${CASHDESK_ID}`);
    const sign = sha256(part1 + part2);

    // Build confirm
    const confirm = md5(`${CASHDESK_ID}:${HASH}`);

    const url = `${BASE_URL}/Cashdesk/${CASHDESK_ID}/Balance?confirm=${confirm}&dt=${encodeURIComponent(dt)}`;

    const response = await axios.get(url, {
      headers: {
        sign,
        login: process.env.XBET_LOGIN
      },
      timeout: 10000,
    });

    return {
      success: true,
      balance: response.data.Balance,
      limit: response.data.Limit,
    };
  } catch (err) {
    console.error('1xBet getBalance error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
};

// ─── 2. Find player ───────────────────────────────────────────────────────
const findPlayer = async (userId) => {
  try {
    // Build signature
    const part1 = sha256(`hash=${HASH}&userid=${userId}&cashdeskid=${CASHDESK_ID}`);
    const part2 = md5(`userid=${userId}&cashierpass=${CASHIER_PASS}&hash=${HASH}`);
    const sign = sha256(part1 + part2);

    // Build confirm
    const confirm = md5(`${userId}:${HASH}`);

    const url = `${BASE_URL}/Users/${userId}?confirm=${confirm}&cashdeskId=${CASHDESK_ID}`;

    const response = await axios.get(url, {
      headers: {
        sign,
        login: process.env.XBET_LOGIN
      },
      timeout: 10000,
    });

    return {
      success: true,
      userId: response.data.userId,
      name: response.data.name,
      currencyId: response.data.currencyId,
    };
  } catch (err) {
    console.error('1xBet findPlayer FULL error:', {
      status: err.response?.status,
      data: JSON.stringify(err.response?.data),
      message: err.message,
    });
    return { success: false, error: err.response?.data?.message || 'Игрок не найден' };
  }
};

// ─── 3. Deposit to player account ────────────────────────────────────────
const depositToPlayer = async (userId, summa) => {
  try {
    const amountNum = parseFloat(summa);
    const summaStr = Number.isInteger(amountNum) ? String(amountNum) : amountNum.toFixed(2);

    const part1 = sha256(`hash=${HASH}&lng=${LNG}&userid=${userId}`);
    const part2 = md5(`summa=${summaStr}&cashierpass=${CASHIER_PASS}&cashdeskid=${CASHDESK_ID}`);
    const sign = sha256(part1 + part2);
    const confirm = md5(`${userId}:${HASH}`);

    console.log('=== DEPOSIT DEBUG ===');
    console.log('userId:', userId);
    console.log('summaStr:', summaStr);
    console.log('amountNum:', amountNum);
    console.log('sign:', sign);
    console.log('===================');

    const url = `${BASE_URL}/Deposit/${userId}/Add`;

    const response = await axios.post(url, {
      cashdeskId: parseInt(CASHDESK_ID),
      lng: LNG,
      summa: amountNum,
      confirm,
    }, {
      headers: {
        sign,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    // Log FULL response
    console.log('DEPOSIT FULL RESPONSE:', JSON.stringify(response.data));

    const data = response.data;

    if (data.Success === true || data.success === true) {
      return {
        success: true,
        summa: data.summa || data.Summa,
        message: data.message || data.Message || 'OK',
        operationId: data.OperationId,
      };
    }

    // API returned Success: false — deposit failed
    return {
      success: false,
      error: data.Message || data.message || 'Deposit failed',
    };
    
  } catch (err) {
    console.error('1xBet deposit FULL error:', JSON.stringify({
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    }));
    return {
      success: false,
      error: err.response?.data?.message || err.response?.data?.title || err.message || 'Ошибка API',
    };
  }
};

// ─── 4. Payout from player account ───────────────────────────────────────
const payoutFromPlayer = async (userId, code) => {
  try {
    // Build signature
    const part1 = sha256(`hash=${HASH}&lng=${LNG}&userid=${userId}`);
    const part2 = md5(`code=${code}&cashierpass=${CASHIER_PASS}&cashdeskid=${CASHDESK_ID}`);
    const sign = sha256(part1 + part2);

    // Build confirm
    const confirm = md5(`${userId}:${HASH}`);

    const url = `${BASE_URL}/Deposit/${userId}/Payout`;

    const response = await axios.post(url, {
      cashdeskId: parseInt(CASHDESK_ID),
      lng: LNG,
      code: String(code),
      confirm,
    }, {
      headers: {
        sign,
        login: process.env.XBET_LOGIN,
        "Content-Type": "application/json"
      },
      timeout: 10000,
    });

    if (!response.data.success && !response.data.Success) {
      return {
        success: false,
        error: response.data.message || 'Ошибка выплаты',
        messageId: response.data.messageId,
      };
    }

    return {
      success: true,
      summa: response.data.summa || response.data.Summa,
      message: response.data.message || response.data.Message,
      operationId: response.data.OperationId,
    };
  } catch (err) {
    console.error('1xBet payout error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || 'Ошибка API' };
  }
};

module.exports = {
  getCashdeskBalance,
  findPlayer,
  depositToPlayer,
  payoutFromPlayer,
};