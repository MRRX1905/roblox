// Narasi review.
//
// Default: template deterministik (tidak mungkin berhalusinasi).
// Opsional: Ollama (settings.ai.enabled) dengan validasi pasca-generasi —
// setiap angka besar yang tidak ada di dataset membatalkan naskah AI.
//
// Setiap naskah punya dua bentuk:
//   text   -> angka sebagai digit, untuk dashboard/overlay
//   speech -> angka dieja bahasa Indonesia, untuk TTS (ArdiNeural ~124 kata/menit)

import { formatNumberId, spellNumbersInText } from '../lib/numbers-id.js';
import { getPackage } from '../config/pricing.js';
import { logger } from '../lib/logger.js';

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(list, seed) {
  return list[seed % list.length];
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function cleanForSpeech(text) {
  return text
    .replace(/Rp\s?/gi, 'rupiah ')
    .replace(/[*_`#>]/g, '')
    .replace(/[!?]+/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Teks -> versi TTS. Nama pengguna dan nama item dilindungi dulu supaya
 * "Rafixx123" tidak berubah menjadi "Rafixx seratus dua puluh tiga".
 */
function toSpeech(text, identifiers = []) {
  let out = cleanForSpeech(text);
  const placeholders = new Map();
  const protectedStrings = [...new Set(identifiers)]
    .filter((value) => typeof value === 'string' && /\d/.test(value) && value.length >= 2)
    .sort((a, b) => b.length - a.length);

  let index = 0;
  for (const value of protectedStrings) {
    // Token tanpa digit: kalau berisi digit, spellNumbersInText akan mengubahnya
    // dan pemulihan nama pengguna gagal.
    const token = `\u0000${String.fromCharCode(0xe000 + index)}\u0000`;
    index += 1;
    if (!out.includes(value)) continue;
    placeholders.set(token, value);
    out = out.split(value).join(token);
  }

  out = spellNumbersInText(out);
  for (const [token, value] of placeholders) out = out.split(token).join(value);
  return out;
}

function identifiersOf(dataset) {
  return [
    dataset.username,
    dataset.displayName,
    ...(dataset.outfit?.items ?? []).map((item) => item.name),
    ...(dataset.collectibles?.items ?? []).map((item) => item.name),
  ].filter(Boolean);
}

function formatDecimal(n) {
  return String(n).replace('.', ',');
}

function yearsText(stats) {
  if (stats.accountAgeYears == null) return null;
  if (stats.accountAgeYears >= 1) return `${formatDecimal(stats.accountAgeYears)} tahun`;
  const days = stats.accountAgeDays ?? 0;
  return `${days} hari`;
}

function outfitSentence(dataset, analysis) {
  const { stats } = analysis;
  if (stats.outfitItems === 0) {
    return 'Outfit-nya belum kebaca, jadi penilaian outfit kita lewati dulu.';
  }
  const category = stats.topCategory ? `, paling banyak bagian ${stats.topCategory.name.toLowerCase()}` : '';
  return `Outfit yang dipakai ada ${stats.outfitItems} item${category}.`;
}

function valueSentence(dataset, analysis) {
  const { stats } = analysis;
  if (stats.outfitItems === 0) return '';
  if (stats.outfitValue == null) {
    return 'Harga itemnya tidak tersedia publik, jadi nilai outfit-nya kita tandai belum tersedia.';
  }
  const partial =
    stats.outfitUnpriced > 0
      ? ` Dari ${stats.outfitItems} item, ${stats.outfitPriced} punya harga publik dan sisanya kita lewati.`
      : '';
  return `Total harga katalog outfit-nya sekitar ${formatNumberId(stats.outfitValue)} Robux. Itu harga katalog hari ini, bukan total uang yang pernah dia keluarkan.${partial}`;
}

function limitedSentence(dataset, analysis) {
  const { stats } = analysis;
  if (dataset.collectibles.status === 'private') {
    return 'Inventory-nya privat, jadi daftar Limited tidak bisa kita lihat.';
  }
  if (stats.limitedCount == null) {
    return 'Data Limited tidak tersedia, jadi kita tidak mengarang angkanya.';
  }
  if (stats.limitedCount === 0) return 'Tidak ada item Limited yang terlihat di inventory publiknya.';
  const rap = stats.limitedRap == null ? '' : ` Nilai rata-rata pasarnya sekitar ${formatNumberId(stats.limitedRap)} Robux.`;
  const truncated = stats.limitedTruncated ? ' Ini baru sebagian yang terbaca.' : '';
  return `Ada ${stats.limitedCount} item Limited yang bisa kita lihat.${rap}${truncated}`;
}

function socialSentence(dataset, analysis) {
  const { stats } = analysis;
  const parts = [];
  if (stats.followers != null) parts.push(`${formatNumberId(stats.followers)} follower`);
  if (stats.friends != null) parts.push(`${formatNumberId(stats.friends)} teman`);
  if (stats.following != null && stats.following > 0) parts.push(`mengikuti ${formatNumberId(stats.following)} akun`);
  if (parts.length === 0) return 'Data sosialnya tidak tersedia, jadi kita lewati.';
  return `Sosialnya: ${parts.join(', ')}.`;
}

const OPENINGS = [
  (u) => `Oke, langsung kita buka akun ${u}!`,
  (u) => `Pesanan baru masuk, ${u}, kita cek sekarang!`,
  (u) => `Kita lihat akun ${u} sebentar lagi.`,
];

const CLOSINGS = [
  'Itu reviewnya. Lanjut ke antrean berikutnya!',
  'Segitu dulu reviewnya, kita lanjut akun berikutnya.',
  'Sudah, itu hasilnya. Berikutnya!',
];

/**
 * Narasi dari template. Tidak memakai jaringan, tidak bisa mengarang angka.
 */
export function buildTemplateNarration(dataset, analysis, { packageId = 'quick' } = {}) {
  const pkg = getPackage(packageId);
  const seed = hash(`${dataset.username}:${packageId}`);
  const opening = pick(OPENINGS, seed)(dataset.username);
  const closing = pick(CLOSINGS, seed >> 3);

  const profileBits = [`Display name-nya ${dataset.displayName}.`];
  const age = yearsText(analysis.stats);
  if (age) profileBits.push(`Akun ini sudah berjalan ${age}.`);
  if (dataset.isPremium) profileBits.push('Akun Premium.');
  if (dataset.hasVerifiedBadge) profileBits.push('Ada badge terverifikasi.');

  const rating = `Rating dariku ${formatDecimal(analysis.score.toFixed(1))} dari 10, kategori ${analysis.verdict.label}. ${analysis.verdict.line}`;

  let text;
  if (pkg.id === 'quick' || pkg.id === 'fast_track') {
    text = [opening, profileBits.join(' '), outfitSentence(dataset, analysis), socialSentence(dataset, analysis), rating, closing]
      .filter(Boolean)
      .join(' ');
  } else {
    const extraLimited = pkg.includeLimiteds ? limitedSentence(dataset, analysis) : '';
    const top = analysis.stats.mostExpensive
      ? `Item termahal yang terpakai: ${analysis.stats.mostExpensive.name}, ${formatNumberId(analysis.stats.mostExpensive.price)} Robux.`
      : '';
    const cta = dataset.dataQuality.partial
      ? 'Catatan: sebagian data tidak terbuka untuk publik, dan itu kita sebut apa adanya.'
      : 'Datanya lengkap dan terbuka.';
    text = [
      opening,
      profileBits.join(' '),
      outfitSentence(dataset, analysis),
      pkg.includeItems ? valueSentence(dataset, analysis) : '',
      top,
      pkg.includeLimiteds ? limitedSentence(dataset, analysis) : '',
      socialSentence(dataset, analysis),
      rating,
      cta,
      closing,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return {
    text,
    speech: toSpeech(text, identifiersOf(dataset)),
    source: 'template',
    meta: { words: countWords(text), packageId: pkg.id },
  };
}

// ------------------------------------------------------------------ AI (opsional)

function collectAllowedNumbers(dataset, analysis) {
  const allowed = new Set([10, 100, 0, 1, 5]);
  const add = (n) => {
    if (Number.isFinite(Number(n))) allowed.add(Math.trunc(Number(n)));
  };
  const s = analysis.stats;
  [
    s.outfitItems,
    s.outfitPriced,
    s.outfitUnpriced,
    s.outfitValue,
    s.limitedCount,
    s.limitedRap,
    s.friends,
    s.followers,
    s.following,
    s.bundleCount,
    s.accountAgeDays,
    s.accountAgeYears ? Math.round(s.accountAgeYears * 10) : null,
    dataset.collectibles.count,
    dataset.outfit.itemCount,
  ].forEach(add);
  for (const item of dataset.outfit.items) add(item.marketPrice);
  for (const item of dataset.collectibles.items) add(item.recentAveragePrice);
  return allowed;
}

/** Angka >= 11 yang tidak ada di dataset = halusinasi -> naskah ditolak. */
function validateNumbers(text, allowed) {
  const normalized = text.replace(/(\d)[.,](\d{3})\b/g, '$1$2');
  const tokens = normalized.match(/\d+/g) ?? [];
  for (const token of tokens) {
    const value = Number(token);
    if (value >= 11 && !allowed.has(value)) return { ok: false, reason: `angka ${value} tidak ada di dataset` };
  }
  return { ok: true };
}

const SYSTEM_PROMPT = `Kamu adalah Roblox Live Reviewer untuk live TikTok berbahasa Indonesia.

Tugas: menulis satu naskah review akun Roblox yang santai, lucu, dan enak dibacakan suara komputer.

Aturan:
1. Pakai HANYA data yang diberikan. Jangan menambah angka, item, atau fakta baru.
2. Jangan menghina fisik atau identitas orang.
3. Sebut harga katalog sebagai harga katalog, bukan uang yang pernah dikeluarkan.
4. Kalau data tidak tersedia, katakan tidak tersedia.
5. Tanpa markdown, tanpa emoji, tanpa daftar bernomor. Hanya kalimat mengalir.
6. Panjang 90 sampai 140 kata.
7. Akhiri dengan ajakan singkat untuk ikut antrean review.`;

export async function buildAiNarration(dataset, analysis, { settings, packageId = 'quick' } = {}) {
  const ai = settings?.ai ?? {};
  const pkg = getPackage(packageId);
  const facts = {
    username: dataset.username,
    displayName: dataset.displayName,
    umurAkunTahun: analysis.stats.accountAgeYears,
    premium: dataset.isPremium,
    verified: dataset.hasVerifiedBadge,
    jumlahItemOutfit: analysis.stats.outfitItems,
    kategoriDominan: analysis.stats.topCategory?.name ?? null,
    itemPunyaHarga: analysis.stats.outfitPriced,
    itemTanpaHarga: analysis.stats.outfitUnpriced,
    totalHargaKatalogOutlet: analysis.stats.outfitValue,
    itemTermahal: analysis.stats.mostExpensive,
    limitedTerlihat: analysis.stats.limitedCount,
    limitedRapTotal: analysis.stats.limitedRap,
    followers: analysis.stats.followers,
    teman: analysis.stats.friends,
    rating: analysis.score,
    kategoriRating: analysis.verdict.label,
    paket: pkg.label,
    dataSebagianHilang: dataset.dataQuality.partial,
  };

  const body = {
    model: ai.model,
    stream: false,
    think: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Data akun (JSON, satu-satunya sumber fakta):\n${JSON.stringify(facts, null, 2)}\n\nTulis naskahnya sekarang.`,
      },
    ],
    options: { temperature: 0.7, num_predict: 500 },
  };

  const response = await fetch(`${(ai.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ai.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  const raw = data?.message?.content ?? '';
  const text = raw
    .replace(/thinking>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < 40) throw new Error('Naskah AI terlalu pendek');
  const check = validateNumbers(text, collectAllowedNumbers(dataset, analysis));
  if (!check.ok) throw new Error(`Naskah AI ditolak: ${check.reason}`);

  return {
    text,
    speech: toSpeech(text, identifiersOf(dataset)),
    source: 'ai',
    meta: { words: countWords(text), packageId: pkg.id },
  };
}

/**
 * Jalur utama: AI kalau diaktifkan dan valid, selain itu template.
 */
export async function buildNarration(dataset, analysis, { settings, packageId = 'quick' } = {}) {
  const template = buildTemplateNarration(dataset, analysis, { packageId });
  if (!settings?.ai?.enabled) return template;
  try {
    return await buildAiNarration(dataset, analysis, { settings, packageId });
  } catch (err) {
    logger.warn('Narasi AI gagal, memakai template', { error: err.message });
    return { ...template, meta: { ...template.meta, aiError: err.message } };
  }
}
