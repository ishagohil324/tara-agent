-- ============================================================
-- Tara Finance Agent — Postgres Schema
-- ============================================================

-- Transactions table: stores all spending/income entries
CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  date          DATE NOT NULL,
  merchant      TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'uncategorized',
  amount        NUMERIC(12, 2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR',
  memo          TEXT,
  -- computed canonical merchant name (for alias grouping)
  merchant_canonical TEXT,
  -- flag self-transfers so we can exclude them from spend
  is_transfer   BOOLEAN NOT NULL DEFAULT FALSE,
  -- flag refunds (negative amounts that reverse a prior purchase)
  is_refund     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the columns tools filter/group by
CREATE INDEX IF NOT EXISTS idx_txn_date        ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_category    ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_merchant    ON transactions(merchant_canonical);
CREATE INDEX IF NOT EXISTS idx_txn_is_transfer ON transactions(is_transfer);
CREATE INDEX IF NOT EXISTS idx_txn_amount      ON transactions(amount);

-- Funds table: metadata about each mutual fund
CREATE TABLE IF NOT EXISTS funds (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL
);

-- Fund NAV history: one row per (fund, date) price point
CREATE TABLE IF NOT EXISTS fund_nav (
  fund_id  TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  nav_date DATE NOT NULL,
  nav      NUMERIC(12, 4) NOT NULL,
  PRIMARY KEY (fund_id, nav_date)
);

CREATE INDEX IF NOT EXISTS idx_nav_fund_date ON fund_nav(fund_id, nav_date);

-- Holdings table: what the user actually owns
CREATE TABLE IF NOT EXISTS holdings (
  id            TEXT PRIMARY KEY,
  fund_id       TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  fund_name     TEXT NOT NULL,
  units         NUMERIC(14, 4) NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_nav  NUMERIC(12, 4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_holdings_fund ON holdings(fund_id);
