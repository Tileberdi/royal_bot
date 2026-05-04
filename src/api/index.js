const express = require('express');
const cors = require('cors');
const db = require('../db');
require('dotenv').config();

const ACCESS_KEY = process.env.ADMIN_PANEL_KEY || 'boss2026';

const app = express();
app.use(cors());
app.use(express.json());

const auth = (req, res, next) => {
  const key = req.headers['x-access-key'];
  if (key !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const { key } = req.body;
  if (key === ACCESS_KEY) {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid key' });
});

app.get('/api/stats', auth, async (req, res) => {
  try {
    const txnStats = await db.getOne(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status IN ('pending','processing')) as pending,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE type = 'deposit' AND status = 'completed') as deposits_count,
        COUNT(*) FILTER (WHERE type = 'withdrawal' AND status = 'completed') as withdrawals_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0) as deposits_sum,
        COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed'), 0) as withdrawals_sum,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND type = 'deposit' AND status = 'completed') as today_deposits_count,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND type = 'withdrawal' AND status = 'completed') as today_withdrawals_count,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE AND type = 'deposit' AND status = 'completed'), 0) as today_deposits,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE AND type = 'withdrawal' AND status = 'completed'), 0) as today_withdrawals
      FROM transactions
    `);

    const userStats = await db.getOne('SELECT COUNT(*) as total FROM users');

    res.json({
      users: parseInt(userStats.total),
      pending: parseInt(txnStats.pending),
      completed: parseInt(txnStats.completed),
      rejected: parseInt(txnStats.rejected),
      deposits: {
        count: parseInt(txnStats.deposits_count),
        sum: parseFloat(txnStats.deposits_sum),
      },
      withdrawals: {
        count: parseInt(txnStats.withdrawals_count),
        sum: parseFloat(txnStats.withdrawals_sum),
      },
      today: {
        deposits: parseFloat(txnStats.today_deposits),
        withdrawals: parseFloat(txnStats.today_withdrawals),
        depositsCount: parseInt(txnStats.today_deposits_count),
        withdrawalsCount: parseInt(txnStats.today_withdrawals_count),
      },
      earnings: parseFloat(txnStats.deposits_sum) - parseFloat(txnStats.withdrawals_sum),
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/pending', auth, async (req, res) => {
  try {
    const pending = await db.getMany(`
      SELECT t.*, u.username, u.full_name
      FROM transactions t
      JOIN users u ON t.user_id = u.telegram_id
      WHERE t.status IN ('pending', 'processing')
      ORDER BY t.created_at ASC
      LIMIT 50
    `);
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/history', auth, async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;
    let where = '1=1';
    const params = [];
    let paramIdx = 1;

    if (type && type !== 'all') {
      where += ` AND t.type = $${paramIdx++}`;
      params.push(type);
    }

    params.push(parseInt(limit), parseInt(offset));

    const transactions = await db.getMany(`
      SELECT t.*, u.username, u.full_name
      FROM transactions t
      JOIN users u ON t.user_id = u.telegram_id
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx}
    `, params);

    res.json(transactions);
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/search', auth, async (req, res) => {
  try {
    const { q, type = 'id' } = req.query;
    if (!q) return res.json([]);

    let results = [];

    if (type === 'id') {
      results = await db.getMany(`
        SELECT t.*, u.username, u.full_name
        FROM transactions t
        JOIN users u ON t.user_id = u.telegram_id
        WHERE t.bookmaker_account_id = $1
        ORDER BY t.created_at DESC LIMIT 20
      `, [q]);
    } else if (type === 'name') {
      results = await db.getMany(`
        SELECT t.*, u.username, u.full_name
        FROM transactions t
        JOIN users u ON t.user_id = u.telegram_id
        WHERE u.full_name ILIKE $1 OR u.username ILIKE $1
        ORDER BY t.created_at DESC LIMIT 20
      `, [`%${q}%`]);
    } else if (type === 'user') {
      results = await db.getMany(`
        SELECT t.*, u.username, u.full_name
        FROM transactions t
        JOIN users u ON t.user_id = u.telegram_id
        WHERE t.user_id = $1
        ORDER BY t.created_at DESC LIMIT 20
      `, [parseInt(q)]);
    }

    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/approve/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE transactions SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await db.query(
      `INSERT INTO admin_logs (admin_id, action, target_id) VALUES ($1, 'approve_web', $2)`,
      [0, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/reject/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE transactions SET status = 'rejected', admin_note = 'Rejected via web panel', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await db.query(
      `INSERT INTO admin_logs (admin_id, action, target_id) VALUES ($1, 'reject_web', $2)`,
      [0, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

const startApi = (port = 3001) => {
  app.listen(port, () => {
    console.log(`🌐 Admin API running on port ${port}`);
  });
};

module.exports = { startApi, app };