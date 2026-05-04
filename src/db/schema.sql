-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(100),
  full_name VARCHAR(200),
  phone VARCHAR(20),
  is_blocked BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bookmakers table
CREATE TABLE IF NOT EXISTS bookmakers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

-- Payment methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'deposit' or 'withdrawal' or 'both'
  is_active BOOLEAN DEFAULT TRUE
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES users(telegram_id),
  type VARCHAR(20) NOT NULL,         -- 'deposit' or 'withdrawal'
  status VARCHAR(30) DEFAULT 'pending', -- pending/processing/completed/rejected/expired
  bookmaker VARCHAR(50),
  bookmaker_account_id VARCHAR(100),
  payment_method VARCHAR(50),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  fee NUMERIC(12, 2) DEFAULT 0,
  final_amount NUMERIC(12, 2),
  withdrawal_code VARCHAR(20),
  receipt_file_id VARCHAR(200),      -- Telegram file_id of receipt photo
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Admin actions log
CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_id VARCHAR(100),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default bookmakers
INSERT INTO bookmakers (name, display_name) VALUES
  ('1xbet', '1XBET'),
  ('melbet', 'MELBET'),
  ('1win', '1WIN'),
  ('mostbet', 'MOSTBET')
ON CONFLICT DO NOTHING;

-- Insert default payment methods
INSERT INTO payment_methods (name, display_name, type) VALUES
  ('mbank', 'MBANK', 'deposit'),
  ('odeньги', 'O!Деньги', 'deposit'),
  ('megapay', 'MegaPay', 'deposit'),
  ('balance', 'Balance', 'deposit'),
  ('bakai', 'BAKAI BANK', 'deposit'),
  ('cash', 'Наличными (Babla.kg)', 'withdrawal')
ON CONFLICT DO NOTHING;