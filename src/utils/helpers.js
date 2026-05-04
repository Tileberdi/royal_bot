const dayjs = require('dayjs');

// Format amount with kopecks: 1000 → "1 000,91"
const formatAmount = (amount) => {
  const num = parseFloat(amount);
  return num.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// Validate that a string is a positive number
const isValidAmount = (str) => {
  const num = parseFloat(str);
  return !isNaN(num) && num >= 35 && num < 1000000;
};

// Validate bookmaker account ID (digits only, 6-15 chars)
const isValidAccountId = (str) => {
  return /^\d{6,15}$/.test(str.trim());
};

// Generate a random alphanumeric code (for withdrawal)
const generateCode = (length = 4) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

// Format a timestamp for display
const formatDate = (date) => {
  return dayjs(date).format('DD.MM.YYYY HH:mm');
};

// Get user display name from Telegram context
const getUserName = (ctx) => {
  const { first_name, last_name, username } = ctx.from;
  if (first_name || last_name) {
    return [first_name, last_name].filter(Boolean).join(' ');
  }
  return username ? `@${username}` : `User ${ctx.from.id}`;
};

// Get user mention for admin messages
const getUserMention = (ctx) => {
  const name = getUserName(ctx);
  return ctx.from.username
    ? `[${name}](https://t.me/${ctx.from.username})`
    : name;
};

// Sleep/delay helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Escape special characters for Telegram Markdown
// Escape special characters for Telegram Markdown

const escapeMd = (text) => {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

module.exports = {
  formatAmount,
  isValidAmount,
  isValidAccountId,
  generateCode,
  formatDate,
  getUserName,
  getUserMention,
  sleep,
  escapeMd
};