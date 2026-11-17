// Pemetaan gift TikTok -> tier paket.
//
// PENTING: isi `giftId` dari event live sungguhan, bukan dari tebakan.
// Jalankan mode live, kirim gift, lalu lihat kolom `gifts.gift_id` di database
// (atau log dashboard). `diamondCount` yang dilaporkan TikTok BUKAN jumlah koin
// yang dibayar penonton, jadi jangan pernah memakai diamond sebagai harga.
//
// Contoh bentuk (angka di bawah hanya placeholder, bukan ID nyata):
//   'GIFT_ID_LOVE_ORANGE': 'fast_track',
//   'GIFT_ID_30_COIN': 'fast_track',
//   'GIFT_ID_VIP': 'vip_express',
//
// Tier hanya boleh menunjuk ke paket gratis/ber-gift: fast_track atau vip_express.

export const GIFT_MAPPING = {
  // Kosong secara sengaja: mapping harus diisi dari event live yang nyata.
};

export const GIFT_TIER_PACKAGE = {
  fast_track: 'fast_track',
  vip_express: 'vip_express',
};

/** Tier untuk sebuah giftId, atau null kalau belum dipetakan. */
export function tierForGift(giftId, mapping = GIFT_MAPPING) {
  const tier = mapping?.[String(giftId)];
  if (!tier) return null;
  const pkg = GIFT_TIER_PACKAGE[tier];
  return pkg ? { tier, package: pkg } : null;
}
