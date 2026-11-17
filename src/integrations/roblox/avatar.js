// Avatar yang sedang dipakai.
// Endpoint utama: GET avatar.roblox.com/v4/avatar/users/{id}
//   -> { avatarModel: { scales, playerAvatarType, bodyColors, assets: [{id,name,assetType{id,name}}] } }
// Fallback (hidup sampai 11 Des 2026): /v1/users/{id}/currently-wearing (hanya daftar assetId).

import { requestJson } from '../../lib/http-client.js';
import { robloxLimiter } from '../../lib/rate-limiter.js';
import { cacheWrap } from '../../lib/cache.js';
import { DEFAULTS } from '../../config/settings.js';

// Tipe asset yang bukan pakaian: animasi, emote, dsb.
// Tetap dikembalikan sebagai "aksesori teknis" tapi dipisah dari outfit.
const NON_OUTFIT_TYPES = new Set([
  'ClimbAnimation',
  'FallAnimation',
  'IdleAnimation',
  'JumpAnimation',
  'RunAnimation',
  'SwimAnimation',
  'WalkAnimation',
  'PoseAnimation',
  'EmoteAnimation',
  'MoodAnimation',
  'Face',
  'FaceAccessory',
]);

function normalizeAsset(asset) {
  const typeName = asset.assetType?.name ?? null;
  return {
    assetId: asset.id,
    name: asset.name ?? null,
    assetTypeId: asset.assetType?.id ?? null,
    category: typeName,
    isOutfit: typeName ? !NON_OUTFIT_TYPES.has(typeName) : true,
  };
}

export async function getAvatar(userId, { ttlSeconds = DEFAULTS.roblox.cacheTtlSeconds.avatar } = {}) {
  return cacheWrap(`roblox:avatar:${userId}`, ttlSeconds * 1000, async () => {
    try {
      const data = await requestJson(`https://avatar.roblox.com/v4/avatar/users/${userId}`, {
        limiter: robloxLimiter,
        bucket: 'users',
      });
      const model = data?.avatarModel ?? data?.avatar ?? null;
      const assets = Array.isArray(model?.assets) ? model.assets.map(normalizeAsset) : [];
      if (!model || assets.length === 0) throw new Error('Avatar kosong');
      return {
        source: 'v4',
        playerAvatarType: model.playerAvatarType ?? null,
        bodyType: model.scales?.bodyType ?? null,
        scales: model.scales ?? null,
        assets,
      };
    } catch (v4Error) {
      // Fallback terakhir sebelum 2D-only: daftar assetId tanpa nama.
      try {
        const data = await requestJson(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`, {
          limiter: robloxLimiter,
          bucket: 'users',
        });
        const assets = (data?.assetIds ?? []).map((id) => ({
          assetId: id,
          name: null,
          assetTypeId: null,
          category: null,
          isOutfit: true,
        }));
        return {
          source: 'currently-wearing',
          playerAvatarType: null,
          bodyType: null,
          scales: null,
          assets,
          warning: `v4 gagal (${v4Error.message}); memakai endpoint fallback yang akan dihapus 11 Des 2026.`,
        };
      } catch (fallbackError) {
        const err = new Error(`Avatar tidak bisa diambil: ${v4Error.message} / ${fallbackError.message}`);
        err.code = 'AVATAR_UNAVAILABLE';
        throw err;
      }
    }
  });
}
