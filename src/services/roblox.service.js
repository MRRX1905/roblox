// Orkestrasi Roblox Data Engine: satu username -> satu dataset yang jujur.
//
// Aturan yang dipegang di seluruh file ini:
// - data yang gagal diambil -> { status: 'unavailable', reason } atau null, TIDAK PERNAH 0
// - nilai outfit dan nilai collectible dihitung terpisah, tidak dijumlahkan
//   menjadi satu "total kekayaan" karangan
// - harga katalog/pasar saat ini bukan pengeluaran historis pengguna

import { resolveUsername, getProfile, accountAgeDays } from '../integrations/roblox/users.js';
import { getAvatar } from '../integrations/roblox/avatar.js';
import { getAvatarImages } from '../integrations/roblox/thumbnails.js';
import { getSocialCounts } from '../integrations/roblox/social.js';
import { getCollectibles, getBundles } from '../integrations/roblox/inventory.js';
import { getItemDetails, marketPrice } from '../integrations/roblox/catalog.js';
import { upsertUser, setAvatarUrl } from '../database/repositories/users.repo.js';
import { logger } from '../lib/logger.js';

function pickMostExpensive(items) {
  let best = null;
  for (const item of items) {
    const price = item.marketPrice ?? item.recentAveragePrice;
    if (price == null || price <= 0) continue;
    if (!best || price > best.price) best = { name: item.name, price };
  }
  return best;
}

function pickCheapest(items) {
  let best = null;
  for (const item of items) {
    const price = item.marketPrice;
    if (price == null || price <= 0) continue;
    if (!best || price < best.price) best = { name: item.name, price };
  }
  return best;
}

/**
 * @param {string} username
 * @returns {Promise<object>} dataset siap dipakai analysis/narasi/overlay
 */
export async function fetchAccount(username) {
  const started = Date.now();
  const resolved = await resolveUsername(username);
  const userId = resolved.id;
  logger.info('Roblox: username ditemukan', { username: resolved.name, userId });

  const [profile, avatarResult, imagesResult, social, collectibles, bundles] = await Promise.all([
    getProfile(userId).catch((err) => ({ error: err.message })),
    getAvatar(userId).catch((err) => ({ error: err.message })),
    getAvatarImages(userId).catch((err) => ({ error: err.message })),
    getSocialCounts(userId),
    getCollectibles(userId),
    getBundles(userId),
  ]);

  const notes = [];
  const missing = [];

  if (profile.error) {
    missing.push('profile');
    notes.push(`Profil tidak terbaca: ${profile.error}`);
  }
  if (avatarResult.error) {
    missing.push('avatar');
    notes.push(`Avatar tidak terbaca: ${avatarResult.error}`);
  }
  if (imagesResult.error) missing.push('thumbnail');
  if (avatarResult.warning) notes.push(avatarResult.warning);
  if (collectibles.status === 'private') notes.push('Inventory privat: daftar Limited tidak bisa dibaca.');
  if (collectibles.status === 'unavailable') notes.push(`Daftar Limited tidak tersedia: ${collectibles.reason}`);
  if (collectibles.truncated) notes.push(`Daftar Limited dipotong di ${collectibles.items.length} item pertama.`);
  if (bundles.status !== 'ok') notes.push('Daftar bundle tidak tersedia.');

  const rawAssets = avatarResult.assets ?? [];
  const outfitAssets = rawAssets.filter((a) => a.isOutfit);
  const technicalCount = rawAssets.length - outfitAssets.length;

  // Harga: item outfit + collectible teratas (untuk item termahal).
  const collectibleSample = collectibles.items.slice(0, 10);
  const priceMap = await getItemDetails([
    ...outfitAssets.map((a) => a.assetId),
    ...collectibleSample.map((c) => c.assetId),
  ]);

  const outfitItems = outfitAssets.map((asset) => {
    const detail = priceMap.get(Number(asset.assetId)) ?? null;
    const resolvedName = asset.name || detail?.name || `Asset ${asset.assetId}`;
    return {
      assetId: asset.assetId,
      name: resolvedName,
      category: asset.category,
      price: detail?.price ?? null,
      marketPrice: marketPrice(detail),
      lowestResalePrice: detail?.lowestResalePrice ?? null,
      isLimited: !!detail?.isLimited,
      priceSource: detail?.source ?? null,
    };
  });

  const priced = outfitItems.filter((i) => i.marketPrice != null && i.marketPrice > 0);
  const outfitTotal = priced.reduce((sum, i) => sum + i.marketPrice, 0);

  const collectibleItems = collectibles.items.map((item) => {
    const detail = priceMap.get(Number(item.assetId)) ?? null;
    const resolvedName = item.name || detail?.name || `Asset ${item.assetId}`;
    return {
      ...item,
      name: resolvedName,
      marketPrice: marketPrice(detail),
      isLimited: true,
    };
  });

  const rapItems = collectibleItems.filter((i) => Number.isFinite(i.recentAveragePrice) && i.recentAveragePrice > 0);
  const rapTotal = rapItems.reduce((sum, i) => sum + i.recentAveragePrice, 0);

  if (outfitItems.length > 0 && priced.length < outfitItems.length) {
    notes.push(`${outfitItems.length - priced.length} item outfit tidak punya harga publik (tidak dijual lagi / data harga kosong).`);
  }

  const socialMissing = ['friends', 'followers', 'following'].filter((k) => social[k]?.status !== 'ok');
  if (socialMissing.length > 0) {
    missing.push(...socialMissing.map((k) => `social.${k}`));
    notes.push(`Sebagian data sosial tidak tersedia: ${socialMissing.join(', ')}.`);
  }
  if (imagesResult.pending?.length) notes.push('Sebagian thumbnail belum siap dibuat Roblox.');

  const dataset = {
    fetchedAt: new Date().toISOString(),
    username: resolved.name,
    userId,
    displayName: profile?.displayName ?? resolved.displayName ?? resolved.name,
    description: profile?.description ?? null,
    created: profile?.created ?? null,
    accountAgeDays: accountAgeDays(profile?.created),
    hasVerifiedBadge: !!(profile?.hasVerifiedBadge ?? resolved.hasVerifiedBadge),
    isPremium: !!profile?.isPremium,
    avatar: {
      source: avatarResult.source ?? null,
      playerAvatarType: avatarResult.playerAvatarType ?? null,
      images: {
        full: imagesResult.full ?? null,
        headshot: imagesResult.headshot ?? null,
        bust: imagesResult.bust ?? null,
      },
      itemCount: rawAssets.length,
      outfitCount: outfitItems.length,
      technicalCount,
    },
    social,
    outfit: {
      items: outfitItems,
      itemCount: outfitItems.length,
      pricedCount: priced.length,
      unpricedCount: outfitItems.length - priced.length,
      totalMarketValue: priced.length > 0 ? outfitTotal : null,
      mostExpensive: pickMostExpensive(outfitItems),
      cheapest: pickCheapest(outfitItems),
    },
    collectibles: {
      status: collectibles.status,
      reason: collectibles.reason ?? null,
      count: collectibleItems.length,
      truncated: !!collectibles.truncated,
      pricedCount: rapItems.length,
      rapTotal: rapItems.length > 0 ? rapTotal : null,
      mostExpensive: pickMostExpensive(collectibleItems),
      items: collectibleItems.slice(0, 25),
    },
    bundles: {
      status: bundles.status,
      count: bundles.count ?? 0,
      items: (bundles.items ?? []).slice(0, 10),
    },
    dataQuality: {
      partial: missing.length > 0 || notes.length > 0,
      missing,
      notes,
    },
  };

  upsertUser({
    id: userId,
    name: resolved.name,
    displayName: dataset.displayName,
    description: dataset.description,
    created: dataset.created,
    isPremium: dataset.isPremium,
    avatarUrl: dataset.avatar.images.full,
    raw: { profile, social, avatarSource: dataset.avatar.source },
  });
  if (dataset.avatar.images.full) setAvatarUrl(userId, dataset.avatar.images.full);

  logger.info('Roblox: dataset selesai', {
    username: dataset.username,
    ms: Date.now() - started,
    outfitItems: dataset.outfit.itemCount,
    priced: dataset.outfit.pricedCount,
    collectibles: dataset.collectibles.count,
    partial: dataset.dataQuality.partial,
  });

  return dataset;
}
