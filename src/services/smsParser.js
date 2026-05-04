const db = require('../db');

// Parse amount from different bank SMS formats
const parseSmSAmount = (text) => {
  if (!text) return null;

  // MBank format: "+1 000.91 KGS" or "Поступление: 1000.91 сом"
  // Bakai format: "Зачисление 1000.91 KGS"
  // Kompanion format: "Пополнение +1000.91"

  const patterns = [
    // +1 000.91 or +1000.91
    /\+?\s*([\d\s]+[.,]\d{2})\s*(KGS|сом|som)/i,
    // Поступление: 1000.91
    /(?:поступление|зачисление|пополнение|приход|получено)[:\s]*([\d\s]+[.,]\d{2})/i,
    // Sum: 1000.91
    /(?:сумма|sum|amount)[:\s]*([\d\s]+[.,]\d{2})/i,
    // Just a number with kopecks like 1000.91
    /([\d\s]+[.,]\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Clean the number: remove spaces, replace comma with dot
      const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
      const amount = parseFloat(cleaned);
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }

  return null;
};

// Parse sender name from SMS
const parseSenderName = (text) => {
  if (!text) return null;

  const patterns = [
    /от\s+(.+?)(?:\s*\d|$|\n)/i,
    /from[:\s]+(.+?)(?:\s*\d|$|\n)/i,
    /отправитель[:\s]+(.+?)(?:\s*\d|$|\n)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }

  return null;
};

// Find matching pending transaction by amount
const findMatchingTransaction = async (amount) => {
  // The kopeck trick makes each amount unique
  // Look for pending/processing deposits with matching final_amount
  const txn = await db.getOne(
    `SELECT t.*, u.telegram_id, u.username, u.full_name
     FROM transactions t
     JOIN users u ON t.user_id = u.telegram_id
     WHERE t.type = 'deposit'
     AND t.status IN ('pending', 'processing')
     AND t.final_amount = $1
     AND t.created_at >= NOW() - INTERVAL '30 minutes'
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [amount]
  );

  return txn;
};

// Also try matching by base amount (without kopecks)
const findMatchingByBaseAmount = async (amount) => {
  const txn = await db.getOne(
    `SELECT t.*, u.telegram_id, u.username, u.full_name
     FROM transactions t
     JOIN users u ON t.user_id = u.telegram_id
     WHERE t.type = 'deposit'
     AND t.status IN ('pending', 'processing')
     AND (t.final_amount = $1 OR t.amount = $1)
     AND t.created_at >= NOW() - INTERVAL '30 minutes'
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [amount]
  );

  return txn;
};

// Save bank notification
const saveBankNotification = async (text, amount, senderName, matchedTxnId) => {
  await db.query(
    `INSERT INTO bank_notifications (raw_text, amount, sender_name, matched_transaction_id, is_matched)
     VALUES ($1, $2, $3, $4, $5)`,
    [text, amount, senderName, matchedTxnId, !!matchedTxnId]
  );
};

// Get unmatched notifications for admin review
const getUnmatched = async (limit = 10) => {
  return db.getMany(
    `SELECT * FROM bank_notifications
     WHERE is_matched = FALSE
     AND received_at >= NOW() - INTERVAL '24 hours'
     ORDER BY received_at DESC
     LIMIT $1`,
    [limit]
  );
};

module.exports = {
  parseSmSAmount,
  parseSenderName,
  findMatchingTransaction,
  findMatchingByBaseAmount,
  saveBankNotification,
  getUnmatched,
};