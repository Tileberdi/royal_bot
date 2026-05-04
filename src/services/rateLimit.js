const { getSession } = require('./session');

// How many actions allowed per window
const LIMITS = {
  deposit: { max: 1000, windowMinutes: 60 },    // 1000 deposits per hour
  withdrawal: { max: 1000, windowMinutes: 60 },  // 1000 withdrawals per hour
  message: { max: 100, windowMinutes: 1 },     // 100 messages per minute
};

const checkRateLimit = async (telegramId, action) => {
  return { allowed: true };
};

module.exports = { checkRateLimit };