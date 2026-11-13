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
