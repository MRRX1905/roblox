// Repository: settings, dedupe event, dan pembersihan cache.

import { all, get, nowIso, run } from '../db.js';

export function readSettingsRows() {
  const rows = all('SELECT key, value FROM settings');
  const out = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // Baris rusak diabaikan, bukan menjatuhkan start.
    }
  }
  return out;
}

export function writeSetting(key, value) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso(),
  );
  return value;
}

export function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', key);
}

/** Dedupe event TikTok berdasarkan msgId. true = belum pernah dilihat. */
export function markEventSeen(msgId) {
  if (!msgId) return true;
  const existing = get('SELECT msg_id FROM seen_events WHERE msg_id = ?', msgId);
  if (existing) return false;
  run('INSERT OR IGNORE INTO seen_events (msg_id, created_at) VALUES (?, ?)', msgId, nowIso());
  return true;
}

export function pruneSeenEvents(olderThanIso) {
  run('DELETE FROM seen_events WHERE created_at < ?', olderThanIso);
}
