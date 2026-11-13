-- D1 schema for 同步碼 (code-based sync). Apply once:
--   npx wrangler d1 execute lingotube-sync --file=deploy/schema.sql
--
-- The server stores only a SHA-256 of the sync code, never the code itself.

CREATE TABLE IF NOT EXISTS spaces (
  code_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  code_hash TEXT NOT NULL,
  rec_id TEXT NOT NULL,
  tbl TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (code_hash, rec_id)
);

CREATE INDEX IF NOT EXISTS records_sync_cursor ON records (code_hash, seq);

-- Usage caps for the public demo (Workers AI quota protection).
-- IPs are stored as SHA-256 hex only, never the raw address.
CREATE TABLE IF NOT EXISTS usage_daily (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);

CREATE TABLE IF NOT EXISTS usage_ip (
  ip_hash TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, bucket, window_start)
);
