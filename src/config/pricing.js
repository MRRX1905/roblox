// Paket review, harga, dan prioritas antrean.
// Angka prioritas mengikuti blueprint: VIP 100, Fast Track 50, Full 40, Normal 10.
// Ubah di sini (atau lewat dashboard) tanpa menyentuh logika lain.

export const PACKAGES = {
  quick: {
    id: 'quick',
    label: 'Quick Review',
    priceIdr: 0,
    priority: 10,
    voice: null, // null = pakai suara default dari settings
    benefits: ['Username & display name', 'Avatar + penilaian outfit', 'Friends, followers, following', 'Komentar singkat'],
    scriptTargetSeconds: 20,
    includeItems: false,
    includeSocial: true,
    includeLimiteds: false,
  },
  fast_track: {
    id: 'fast_track',
    label: 'Fast Track',
    priceIdr: 0,
    giftTier: 'fast_track',
    priority: 50,
    voice: null,
    benefits: ['Semua fitur Quick Review', 'Prioritas antrean', 'Notifikasi khusus di live'],
    scriptTargetSeconds: 25,
    includeItems: false,
    includeSocial: true,
    includeLimiteds: false,
  },
  full: {
    id: 'full',
    label: 'Full Review',
    priceIdr: 5000,
    priority: 40,
    voice: null,
    benefits: ['Analisis avatar lebih detail', 'Harga tiap item teridentifikasi', 'Estimasi nilai outfit', 'Analisis profil sosial'],
    scriptTargetSeconds: 45,
    includeItems: true,
    includeSocial: true,
    includeLimiteds: true,
  },
  vip_express: {
    id: 'vip_express',
    label: 'VIP Express',
    priceIdr: 10000,
    priority: 100,
    voice: null,
    benefits: ['Semua fitur Full Review', 'Prioritas tertinggi', 'Statistik tambahan', 'Analisis item Limited', 'Naskah lebih detail'],
    scriptTargetSeconds: 60,
    includeItems: true,
    includeSocial: true,
    includeLimiteds: true,
  },
};

export const PAYMENT_PACKAGES = ['full', 'vip_express'];

export const STATUS = {
  WAITING: 'waiting',
  PROCESSING: 'processing',
  GENERATING_AUDIO: 'generating_audio',
  PLAYING: 'playing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const ACTIVE_STATUSES = [STATUS.WAITING, STATUS.PROCESSING, STATUS.GENERATING_AUDIO, STATUS.PLAYING];

export function getPackage(id) {
  const pkg = PACKAGES[id];
  if (!pkg) {
    const err = new Error(`Paket tidak dikenal: ${id}`);
    err.code = 'UNKNOWN_PACKAGE';
    throw err;
  }
  return pkg;
}

/** Paket yang boleh dipakai untuk jalur komentar gratis. */
export function isFreePackage(id) {
  return id === 'quick' || id === 'fast_track';
}

/** Paket berbayar harus punya pembayaran verified sebelum masuk antrean. */
export function requiresPayment(id) {
  return PAYMENT_PACKAGES.includes(id);
}
