// Konfigurasi default. Nilai ini bisa ditimpa dari tabel `settings` lewat dashboard.
// Jangan menaruh rahasia di sini — pakai .env.

export const DEFAULTS = {
  tiktok: {
    // 'demo' = event palsu dari tiklive (untuk uji), 'live' = konek ke room TikTok sungguhan.
    mode: 'demo',
    username: 'demo',
    // Command yang dikenali di kolom komentar.
    commands: { review: '!review', full: '!full', queue: '!queue' },
    cooldownSeconds: 60, // per user TikTok, per username Roblox
    maxActivePerUser: 1,
  },
  tts: {
    engine: 'edge', // 'edge' | 'none'
    voice: 'id-ID-ArdiNeural',
    altVoice: 'id-ID-GadisNeural',
    rate: '+0%',
    pitch: '+0Hz',
    // Dipakai kalau edge-tts menolak (Microsoft kadang mematahkan Read Aloud API).
    pythonFallback: false,
  },
  audio: {
    // Nama device output persis seperti di Windows, mis. "CABLE Input (VB-Audio Virtual Cable)".
    // Kosong = pakai device default Windows.
    device: '',
    volume: 1,
  },
  ai: {
    // Default mati: narasi memakai template deterministik.
    enabled: false,
    model: 'qwen3.5:9b',
    baseUrl: 'http://127.0.0.1:11434',
    timeoutMs: 60000,
  },
  roblox: {
    maxInventoryPages: 5,
    cacheTtlSeconds: {
      profile: 600,
      avatar: 600,
      social: 600,
      collectibles: 600,
      price: 3600,
      thumbnail: 3600,
    },
  },
  review: {
    maxWords: 140,
    minWords: 90,
  },
  queue: {
    // Berapa pekerjaan prioritas berturut-turut sebelum satu pekerjaan normal dilayani.
    maxConsecutivePriority: 2,
  },
  worker: {
    enabled: true,
  },
};

export function mergeSettings(defaults, override) {
  if (!override || typeof override !== 'object') return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(override)) {
    const base = out[key];
    if (
      base &&
      typeof base === 'object' &&
      !Array.isArray(base) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = mergeSettings(base, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
