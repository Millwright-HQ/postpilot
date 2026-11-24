import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });
export const db = new DatabaseSync('data/postpilot.db');

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- connected social accounts (one row per Facebook Page / IG account / YouTube channel / TikTok user)
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,     -- facebook | instagram | youtube | tiktok
  external_id   TEXT NOT NULL,     -- page id / ig user id / channel id / tiktok open_id
  name          TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,              -- UTC ISO; null = doesn't expire
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (platform, external_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  caption      TEXT NOT NULL DEFAULT '',
  media_file   TEXT,                 -- filename inside /uploads
  media_type   TEXT,                 -- 'image' | 'video' | null
  scheduled_at TEXT NOT NULL,        -- UTC ISO string
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- one row per account a post goes to, each with its own status/retries
CREATE TABLE IF NOT EXISTS targets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  platform     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | publishing | published | failed
  run_at       TEXT NOT NULL,        -- when to (next) attempt, UTC ISO
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  remote_id    TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_targets_due ON targets(status, run_at);
`);

// migration for databases created before accounts existed
if (!db.prepare(`PRAGMA table_info(targets)`).all().some((c) => c.name === 'account_id')) {
  db.exec(`ALTER TABLE targets ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL`);
}

// crash recovery: anything stuck mid-publish goes back in the queue
db.exec(`UPDATE targets SET status='scheduled' WHERE status='publishing'`);
