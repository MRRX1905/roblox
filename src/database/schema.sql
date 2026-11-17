-- Skema database. Diterapkan idempotent saat start.
-- Catatan: antrean digabung ke tabel `requests` (kolom priority/status/enqueued_at)
-- supaya tidak ada dua sumber kebenaran yang bisa desinkron.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                 -- Roblox userId
  username TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  created_roblox TEXT,
  is_premium INTEGER,
  avatar_url TEXT,
  fetched_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tiktok_user TEXT,
  roblox_username TEXT NOT NULL,
  roblox_user_id INTEGER,
  package TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  payment_status TEXT NOT NULL DEFAULT 'not_required',
  source TEXT NOT NULL DEFAULT 'manual',   -- chat | gift | manual | demo
  message_id TEXT,
  note TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  enqueued_at TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_message
  ON requests(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_queue
  ON requests(status, priority DESC, enqueued_at ASC);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  package TEXT NOT NULL,
  amount_idr INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'manual',   -- manual | gift
  txn_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | rejected
  note TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  tiktok_user TEXT,
  gift_id TEXT NOT NULL,
  gift_name TEXT,
  diamonds INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 1,
  tier TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gifts_created ON gifts(created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  roblox_user_id INTEGER,
  score REAL,
  score_breakdown TEXT,
  dataset TEXT,
  narration_text TEXT,
  narration_speech TEXT,
  narration_source TEXT,                   -- template | ai
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  asset_id TEXT,
  name TEXT,
  kind TEXT,                               -- equipped | collectible | bundle
  category TEXT,
  price INTEGER,
  resale_price INTEGER,
  is_limited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_review_items_review ON review_items(review_id);

CREATE TABLE IF NOT EXISTS speech_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  review_id INTEGER REFERENCES reviews(id) ON DELETE SET NULL,
  voice TEXT,
  audio_path TEXT,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | playing | played | failed | skipped
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  played_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_speech_status ON speech_jobs(status, created_at ASC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_events (
  msg_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
