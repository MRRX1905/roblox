// Inventory publik: Limited (collectibles) dan bundle.
//
// Kenyataan per Jan 2026: Roblox menegakkan privasi inventory di semua endpoint
// web inventory v1/v2, dan Open Cloud butuh API key milik pemilik akun. Jadi:
// - kalau inventory privat -> status 'private', BUKAN "kosong"
// - daftar collectibles kadang tidak memuat dynamic head/bundle -> ditambal /bundles
// - item yang sudah ditrade masih bisa muncul -> ditandai apa adanya, tidak diklaim akurat

import { requestJson } from '../../lib/http-client.js';
import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheWrap } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';

export async function canViewInventory(userId) {
  try {
    const data = await requestJson(`https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`, {
      limiter: robloxLimiter,
      bucket: 'inventory',
      // can-view-inventory adalah salah satu endpoint paling ketat; kalau gagal
      // kita lanjut dan biarkan daftar collectibles yang menentukan statusnya.
      retries: 0,
    });
    return data?.canView === true;
  } catch {
    return null; // tidak diketahui; jangan diasumsikan privat atau publik
  }
}

export async function getCollectibles(userId, { maxPages = DEFAULTS.roblox.maxInventoryPages, ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.collectibles } = {}) {
  return cacheWrap(`roblox:collectibles:${userId}`, ttlSeconds * 1000, async () => {
    const viewable = await canViewInventory(userId);
    if (viewable === false) {
      return { status: 'private', reason: 'Inventory akun ini privat', items: [], count: 0, truncated: false };
    }

    const items = [];
    let cursor = null;
    let pages = 0;
    let truncated = false;
    try {
      for (;;) {
        const url = new URL(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles`);
        url.searchParams.set('limit', '100');
        url.searchParams.set('sortOrder', 'Desc');
        if (cursor) url.searchParams.set('cursor', cursor);
        const data = await requestJson(url.toString(), { limiter: robloxLimiter, bucket: 'inventory' });
        for (const row of data?.data ?? []) {
          items.push({
            assetId: row.assetId,
            userAssetId: row.userAssetId ?? null,
            serialNumber: row.serialNumber ?? null,
            name: row.name ?? null,
            recentAveragePrice: row.recentAveragePrice ?? null,
            originalPrice: row.originalPrice ?? null,
          });
        }
        pages += 1;
        cursor = data?.nextPageCursor ?? null;
        if (!cursor) break;
        if (pages >= maxPages) {
          truncated = true;
          break;
        }
      }
      return { status: 'ok', items, count: items.length, truncated, pages };
    } catch (err) {
      return {
        status: 'unavailable',
        reason: err.status === 403 ? 'Akses inventory ditolak Roblox' : err.message,
        items,
        count: items.length,
        truncated,
        pages,
      };
    }
  });
}

export async function getBundles(userId) {
  try {
    const data = await requestJson(`https://catalog.roblox.com/v1/users/${userId}/bundles?limit=100`, {
      limiter: robloxLimiter,
      bucket: 'catalog',
    });
    const items = (data?.data ?? []).map((b) => ({
      bundleId: b.id,
      name: b.name ?? null,
      bundleType: b.bundleType ?? null,
    }));
    return { status: 'ok', items, count: items.length, truncated: !!data?.nextPageCursor };
  } catch (err) {
    return { status: 'unavailable', reason: err.message, items: [], count: 0 };
  }
}
