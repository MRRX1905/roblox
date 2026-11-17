// Jumlah teman, follower, dan following.
// Domain friends.roblox.com paling agresif membalas 429; kalau satu gagal,
// field itu ditandai unavailable — bukan diisi 0.

import { requestJson } from '../../lib/http-client.js';
import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheWrap } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';

async function count(path, label) {
  try {
    const data = await requestJson(`https://friends.roblox.com${path}`, {
      limiter: robloxLimiter,
      bucket: 'friends',
      retries: 1,
    });
    const value = Number(data?.count);
    if (!Number.isFinite(value)) return { status: 'unavailable', reason: 'count tidak ada di respons', value: null };
    return { status: 'ok', value };
  } catch (err) {
    return { status: 'unavailable', reason: `${label}: ${err.message}`, value: null };
  }
}

export async function getSocialCounts(userId, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.social } = {}) {
  return cacheWrap(`roblox:social:${userId}`, ttlSeconds * 1000, async () => {
    const [friends, followers, following] = await Promise.all([
      count(`/v1/users/${userId}/friends/count`, 'friends'),
      count(`/v1/users/${userId}/followers/count`, 'followers'),
      count(`/v1/users/${userId}/followings/count`, 'following'),
    ]);
    return { friends, followers, following };
  });
}
