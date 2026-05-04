const db = require('../db');
const { generateCode } = require('../utils/helpers');
const { setTransactionTimer } = require('./session');

// Register a new user or return existing
const upsertUser = async (telegramUser) => {
  const { id, username, first_name, last_name } = telegramUser;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');

  const result = await db.query(
    `INSERT INTO users (telegram_id, username, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       updated_at = NOW()
     RETURNING *`,
    [id, username || null, fullName]
  );
  return result.rows[0];
};

// Check if user is blocked
const isUserBlocked = async (telegramId) => {
  const user = await db.getOne(
    'SELECT is_blocked FROM users WHERE telegram_id = $1',
    [telegramId]
  );
  return user ? user.is_blocked : false;
};

// Create a new deposit transaction
const createDeposit = async ({ telegramId, bookmaker, accountId, amount, finalAmount, paymentMethod }) => {
  // Use finalAmount from session if available, otherwise generate kopecks
  const computedFinal = finalAmount || (parseFloat(amount) + (Math.floor(Math.random() * 98) + 1) / 100);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const result = await db.query(
    `INSERT INTO transactions
      (user_id, type, status, bookmaker, bookmaker_account_id, payment_method, amount, final_amount, expires_at)
     VALUES ($1, 'deposit', 'pending', $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [telegramId, bookmaker, accountId, paymentMethod, amount, computedFinal, expiresAt]
  );

  const txn = result.rows[0];
  await setTransactionTimer(txn.id, telegramId, 10);
  return txn;
};

// Create a new withdrawal transaction
const createWithdrawal = async ({ telegramId, bookmaker, accountId, amount, withdrawalCode }) => {
  const code = withdrawalCode || generateCode(4);

  const result = await db.query(
    `INSERT INTO transactions
      (user_id, type, status, bookmaker, bookmaker_account_id, payment_method, amount, final_amount, withdrawal_code)
     VALUES ($1, 'withdrawal', 'pending', $2, $3, 'cash', $4, $4, $5)
     RETURNING *`,
    [telegramId, bookmaker, accountId, amount, code]
  );

  return result.rows[0];
};

// Attach receipt photo to a transaction
const attachReceipt = async (transactionId, fileId) => {
  await db.query(
    `UPDATE transactions SET receipt_file_id = $1, status = 'processing', updated_at = NOW()
     WHERE id = $2`,
    [fileId, transactionId]
  );
};

// Admin: approve a transaction
const approveTransaction = async (transactionId, adminId) => {
  await db.query(
    `UPDATE transactions SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [transactionId]
  );
  await db.query(
    `INSERT INTO admin_logs (admin_id, action, target_id) VALUES ($1, 'approve', $2)`,
    [adminId, transactionId]
  );
};

// Admin: reject a transaction
const rejectTransaction = async (transactionId, adminId, reason) => {
  await db.query(
    `UPDATE transactions SET status = 'rejected', admin_note = $1, updated_at = NOW()
     WHERE id = $2`,
    [reason, transactionId]
  );
  await db.query(
    `INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES ($1, 'reject', $2, $3)`,
    [adminId, transactionId, JSON.stringify({ reason })]
  );
};

// Get user's recent transactions
const getUserTransactions = async (telegramId, limit = 10) => {
  return db.getMany(
    `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [telegramId, limit]
  );
};

// Get transaction by ID
const getTransaction = async (transactionId) => {
  return db.getOne('SELECT * FROM transactions WHERE id = $1', [transactionId]);
};

module.exports = {
  upsertUser,
  isUserBlocked,
  createDeposit,
  createWithdrawal,
  attachReceipt,
  approveTransaction,
  rejectTransaction,
  getUserTransactions,
  getTransaction,
};