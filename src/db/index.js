const { Pool } = require('pg');
require('dotenv').config();

// Create a connection pool — reuses connections for performance
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

// Test connection on startup
pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Database connected');
  }
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
});

// Helper: run a query
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('📊 Query:', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    console.error('❌ Query error:', { text, error: err.message });
    throw err;
  }
};

// Helper: get a single row
const getOne = async (text, params) => {
  const result = await query(text, params);
  return result.rows[0] || null;
};

// Helper: get multiple rows
const getMany = async (text, params) => {
  const result = await query(text, params);
  return result.rows;
};

module.exports = { pool, query, getOne, getMany };