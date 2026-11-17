// Thumbnail avatar (2D). Endpoint 3D butuh auth (403 tanpa login), jadi
// yang dipakai hanya avatar penuh + headshot, dengan polling state karena
// Roblox mengembalikan state "Pending" lebih dulu.

import { requestJson } from '../../lib/http-client.js';
import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheWrap } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchThumb(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    const data = await requestJson(url, { limiter: robloxLimiter, bucket: 'thumbnails' });
    const item = data?.data?.[0];
    if (item?.state === 'Completed' && item.imageUrl) return item.imageUrl;
    last = item?.state ?? 'unknown';
    if (item?.state === 'Blocked' || item?.state === 'Error') break;
    // "Pending" / "InReview": beri waktu Roblox membuat thumbnail.
    await sleep(600 + i * 500);
  }
  return { pending: last ?? 'unknown' };
}

export async function getAvatarImages(userId, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.thumbnail } = {}) {
  return cacheWrap(`roblox:thumb:${userId}`, ttlSeconds * 1000, async () => {
    const result = { full: null, headshot: null, bust: null, pending: [] };
    try {
      const full = await fetchThumb(
        `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
      );
      if (typeof full === 'string') result.full = full;
      else result.pending.push({ kind: 'full', state: full.pending });
    } catch (err) {
      result.pending.push({ kind: 'full', state: `error: ${err.message}` });
    }
    try {
      const head = await fetchThumb(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
      );
      if (typeof head === 'string') result.headshot = head;
      else result.pending.push({ kind: 'headshot', state: head.pending });
    } catch (err) {
      result.pending.push({ kind: 'headshot', state: `error: ${err.message}` });
    }
    // Avatar penuh bisa dipakai sebagai bust kalau headshot tertunda.
    result.bust = result.headshot || result.full || null;
    return result;
  });
}
