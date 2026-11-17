// Harga item.
//
// Endpoint POST /v1/catalog/items/details butuh handshake XSRF:
// permintaan pertama dibalas 403 + header `x-csrf-token`, lalu diulang dengan
// header itu. Sudah diverifikasi lewat probe (403 -> 200).
//
// Fallback per-item: economy.roblox.com/v2/assets/{id}/details, yang tetap
// terbuka tanpa login dan memberi PriceInRobux / IsLimited / harga resale.

import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';
import { logger } from '../../lib/logger.js';

const UA = 'roblox-live-review/0.1 (+local tool)';
const BATCH_URL = 'https://catalog.roblox.com/v1/catalog/items/details';
const BATCH_SIZE = 100;

let csrfToken = null;
let csrfExpiresAt = 0;

function normalizeDetail(detail) {
  const restrictions = detail.itemRestrictions ?? [];
  const isLimited = restrictions.includes('Limited') || restrictions.includes('LimitedUnique') || !!detail.collectibleItemId;
  // Item lama yang sudah tidak dijual dilaporkan price 0, bukan null.
  // Kalau tidak bisa dibeli dan harganya 0, itu bukan harga katalog.
  const rawPrice = Number.isFinite(detail.price) ? detail.price : null;
  const price = rawPrice === 0 && detail.isPurchasable === false ? null : rawPrice;
  const lowestResalePrice = Number.isFinite(detail.lowestResalePrice) ? detail.lowestResalePrice : null;
  return {
    assetId: detail.id,
    name: detail.name ?? null,
    assetType: detail.assetType ?? null,
    price,
    lowestPrice: Number.isFinite(detail.lowestPrice) ? detail.lowestPrice : null,
    lowestResalePrice,
    isLimited,
    isPurchasable: !!detail.isPurchasable,
    collectibleItemId: detail.collectibleItemId ?? null,
    source: 'catalog',
  };
}

async function postBatch(ids) {
  const body = JSON.stringify({
    items: ids.map((id) => ({ itemType: 'Asset', id: Number(id) })),
    salesTypeFilter: 1,
  });

  const send = async (token) => {
    await robloxLimiter.acquire('catalog');
    return fetch(BATCH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': UA,
        ...(token ? { 'x-csrf-token': token } : {}),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  };

  let response = await send(csrfToken && csrfExpiresAt > Date.now() ? csrfToken : null);
  if (response.status === 403) {
    const fresh = response.headers.get('x-csrf-token');
    if (!fresh) throw new Error('Roblox menolak batch harga (403) tanpa token XSRF');
    csrfToken = fresh;
    csrfExpiresAt = Date.now() + 30 * 60_000;
    response = await send(csrfToken);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Batch harga gagal: HTTP ${response.status} ${text.slice(0, 120)}`);
  }
  const data = await response.json();
  return (data?.data ?? []).map(normalizeDetail);
}

async function fallbackDetail(assetId) {
  await robloxLimiter.acquire('economy');
  const response = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    assetId: Number(data.AssetId ?? assetId),
    name: data.Name ?? null,
    assetType: data.AssetTypeId ?? null,
    // PriceInRobux 0 untuk item lama = tidak dijual lagi, bukan "gratis".
    price: Number.isFinite(data.PriceInRobux) && !(data.PriceInRobux === 0 && !data.IsForSale) ? data.PriceInRobux : null,
    lowestPrice: null,
    lowestResalePrice: Number.isFinite(data.CollectiblesItemDetails?.CollectibleLowestResalePrice)
      ? data.CollectiblesItemDetails.CollectibleLowestResalePrice
      : null,
    isLimited: !!data.IsLimited,
    isPurchasable: !!data.IsForSale,
    collectibleItemId: data.CollectibleItemId ?? null,
    source: 'economy',
  };
}

/**
 * Harga beberapa asset sekaligus, memakai cache per asset.
 * @returns {Promise<Map<number, object|null>>} null = harga tidak tersedia.
 */
export async function getItemDetails(assetIds, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.price } = {}) {
  const unique = [...new Set(assetIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const result = new Map();
  const missing = [];

  for (const id of unique) {
    const cached = cacheGet(`roblox:item:${id}`);
    if (cached !== undefined) result.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    let details = [];
    try {
      details = await postBatch(chunk);
    } catch (err) {
      logger.warn('Batch harga catalog gagal, memakai fallback economy', { error: err.message, count: chunk.length });
    }
    const found = new Map(details.map((d) => [Number(d.assetId), d]));

    for (const id of chunk) {
      let detail = found.get(id) ?? null;
      if (!detail) {
        try {
          detail = await fallbackDetail(id);
        } catch (err) {
          logger.debug('Fallback harga gagal', { assetId: id, error: err.message });
          detail = null;
        }
      }
      cacheSet(`roblox:item:${id}`, detail, ttlSeconds * 1000);
      result.set(id, detail);
    }
  }

  return result;
}

/** Harga pasar yang paling relevan: resale floor untuk Limited, harga katalog untuk sisanya. */
export function marketPrice(detail) {
  if (!detail) return null;
  if (detail.isLimited && detail.lowestResalePrice != null) return detail.lowestResalePrice;
  if (detail.price != null) return detail.price;
  if (detail.lowestResalePrice != null) return detail.lowestResalePrice;
  return null;
}

export function resetCsrfToken() {
  csrfToken = null;
  csrfExpiresAt = 0;
}
