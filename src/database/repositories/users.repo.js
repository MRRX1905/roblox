// Repository: data akun Roblox yang pernah direview (cache jangka panjang).

import { all, get, nowIso, run } from '../db.js';

export function upsertUser(profile) {
  const userId = Number(profile.id ?? profile.userId);
  run(
    `INSERT INTO users (id, username, display_name, description, created_roblox, is_premium, avatar_url, fetched_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       display_name = excluded.display_name,
       description = excluded.description,
       created_roblox = excluded.created_roblox,
       is_premium = excluded.is_premium,
       avatar_url = COALESCE(excluded.avatar_url, users.avatar_url),
       fetched_at = excluded.fetched_at,
       raw_json = excluded.raw_json`,
    userId,
    profile.name ?? profile.username ?? null,
    profile.displayName ?? null,
    profile.description ?? null,
    profile.created ?? null,
    profile.isPremium ? 1 : 0,
    profile.avatarUrl ?? null,
    nowIso(),
    JSON.stringify(profile.raw ?? profile),
  );
  return getUser(userId);
}

export function getUser(userId) {
  return get('SELECT * FROM users WHERE id = ?', Number(userId));
}

export function findUserByUsername(username) {
  return get('SELECT * FROM users WHERE lower(username) = lower(?)', username);
}

export function listUsers(limit = 50) {
  return all('SELECT id, username, display_name, avatar_url, fetched_at FROM users ORDER BY fetched_at DESC LIMIT ?', limit);
}

export function setAvatarUrl(userId, avatarUrl) {
  run('UPDATE users SET avatar_url = ? WHERE id = ?', avatarUrl, Number(userId));
}
