// Cache ber-TTL di SQLite. Dipakai untuk data Roblox yang mahal/ber-rate-limit.
// Nilai disimpan sebagai JSON.

import { get, run } from '../database/db.js';

export function cacheGet(key) {
  const row = get('SELECT value, expires_at FROM cache WHERE key = ?', key);
  if (!row) return undefined;
  if (row.expires_at < Date.now()) {
    run('DELETE FROM cache WHERE key = ?', key);
    return undefined;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

export function cacheSet(key, value, ttlMs) {
  run(
    'INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    key,
    JSON.stringify(value),
    Date.now() + Math.max(0, ttlMs),
  );
  return value;
}

/** Ambil dari cache; kalau kosong jalankan fn dan simpan hasilnya. */
export async function cacheWrap(key, ttlMs, fn) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined) cacheSet(key, value, ttlMs);
  return value;
}

export function cacheClear(prefix = '') {
  if (!prefix) run('DELETE FROM cache');
  else run('DELETE FROM cache WHERE key LIKE ?', `${prefix}%`);
}
