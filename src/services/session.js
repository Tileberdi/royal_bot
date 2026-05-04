const redis = require('redis');
require('dotenv').config();

let client;

const getClient = async () => {
  if (!client) {
    client = redis.createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('❌ Redis error:', err));
    client.on('connect', () => console.log('✅ Redis connected'));
    await client.connect();
  }
  return client;
};

// Save session data for a user
const setSession = async (telegramId, data, expiryMinutes = 30) => {
  const c = await getClient();
  const key = `session:${telegramId}`;
  await c.setEx(key, expiryMinutes * 60, JSON.stringify(data));
};

// Get session data for a user
const getSession = async (telegramId) => {
  const c = await getClient();
  const key = `session:${telegramId}`;
  const data = await c.get(key);
  return data ? JSON.parse(data) : {};
};

// Update one field in the session
const updateSession = async (telegramId, updates) => {
  const current = await getSession(telegramId);
  await setSession(telegramId, { ...current, ...updates });
};

// Clear the session (after transaction completes)
const clearSession = async (telegramId) => {
  const c = await getClient();
  await c.del(`session:${telegramId}`);
};

// Set a temporary expiry timer for a transaction
const setTransactionTimer = async (transactionId, telegramId, minutes = 10) => {
  const c = await getClient();
  const key = `txn_timer:${transactionId}`;
  await c.setEx(key, minutes * 60, String(telegramId));
};

// Check if transaction timer is still active
const checkTransactionTimer = async (transactionId) => {
  const c = await getClient();
  const key = `txn_timer:${transactionId}`;
  const ttl = await c.ttl(key);
  return ttl > 0 ? ttl : null; // returns seconds remaining or null if expired
};

module.exports = {
  setSession,
  getSession,
  updateSession,
  clearSession,
  setTransactionTimer,
  checkTransactionTimer,
};