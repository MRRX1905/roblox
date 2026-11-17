// Resolusi username -> userId dan profil publik.
// Endpoint users.roblox.com tidak butuh cookie, tapi batas anonim per IP
// dipotong menjadi 100 req/detik pada Okt 2026 — semua lewat limiter + cache.

import { requestJson } from '../../lib/http-client.js';
import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheWrap } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function isValidRobloxUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username.trim());
}

export async function resolveUsername(username, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.profile } = {}) {
  const clean = String(username || '').trim();
  if (!isValidRobloxUsername(clean)) {
    const err = new Error(`Format username Roblox tidak valid: "${clean}"`);
    err.code = 'INVALID_USERNAME';
    throw err;
  }
  return cacheWrap(`roblox:resolve:${clean.toLowerCase()}`, ttlSeconds * 1000, async () => {
    const data = await requestJson('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      body: { usernames: [clean], excludeBannedUsers: false },
      limiter: robloxLimiter,
      bucket: 'users',
      retries: 2,
    });
    const user = data?.data?.[0];
    if (!user) {
      const err = new Error(`Username Roblox "${clean}" tidak ditemukan`);
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    return { id: user.id, name: user.name, displayName: user.displayName, hasVerifiedBadge: !!user.hasVerifiedBadge };
  });
}

export async function getProfile(userId, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.profile } = {}) {
  return cacheWrap(`roblox:profile:${userId}`, ttlSeconds * 1000, async () => {
    const data = await requestJson(`https://users.roblox.com/v1/users/${userId}`, {
      limiter: robloxLimiter,
      bucket: 'users',
    });
    return {
      id: data.id,
      name: data.name,
      displayName: data.displayName,
      description: data.description || null,
      created: data.created || null,
      isBanned: !!data.isBanned,
      hasVerifiedBadge: !!data.hasVerifiedBadge,
    };
  });
}

/** Umur akun dalam hari; null kalau tanggal lahir akun tidak tersedia. */
export function accountAgeDays(createdIso) {
  if (!createdIso) return null;
  const created = Date.parse(createdIso);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
}
