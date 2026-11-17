// Parser gift TikTok.
//
// Gift ber-streak (Rose, dsb) mengirim event berulang dengan streaking=true dan
// repeatCount naik. Hanya event terakhir (streaking=false) yang diproses, supaya
// satu combo tidak dihitung berkali-kali.
//
// diamondCount BUKAN jumlah koin yang dibayar penonton. Nilainya hanya dicatat
// sebagai diamond, tidak pernah dipakai sebagai harga paket.

import { GIFT_MAPPING, tierForGift } from '../../config/gifts.js';

export function normalizeGiftEvent(event, mapping = GIFT_MAPPING) {
  const repeatCount = Number(event?.repeatCount ?? 1) || 1;
  const diamondCount = Number(event?.diamondCount ?? 0) || 0;
  const tier = tierForGift(event?.giftId, mapping);
  return {
    giftId: event?.giftId == null ? null : String(event.giftId),
    giftName: event?.giftName ?? null,
    repeatCount,
    diamondCount,
    totalDiamonds: Number(event?.totalDiamonds ?? diamondCount * repeatCount) || 0,
    streaking: event?.streaking !== false,
    isFinal: event?.streaking === false,
    tiktokUser: event?.user?.uniqueId ?? null,
    nickname: event?.user?.nickname ?? null,
    tier: tier?.tier ?? null,
    packageId: tier?.package ?? null,
  };
}

/**
 * Gift yang layak diproses sebagai prioritas: combo sudah selesai DAN
 * giftId-nya sudah dipetakan ke paket.
 */
export function shouldProcessGift(normalized) {
  return !!normalized?.isFinal && !!normalized.packageId;
}
