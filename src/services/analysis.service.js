// Analisis deterministik: semua angka dihitung di sini, bukan oleh AI.
//
// Rating adalah penilaian hiburan berdasarkan komponen yang terbuka di kode ini,
// bukan statistik resmi Roblox. Komponennya:
//   outfit  0-4  (jumlah item, harga teridentifikasi, ada Limited, variasi kategori)
//   sosial  0-3  (follower, teman, badge terverifikasi)
//   profil  0-2  (umur akun, premium, display name)
//   rapi    0-1  (variasi kategori outfit)

import { formatNumberId } from '../lib/numbers-id.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function socialValue(field) {
  return field?.status === 'ok' && Number.isFinite(field.value) ? field.value : null;
}

function outfitScore(outfit) {
  let score = 0;
  const count = outfit.itemCount;
  if (count >= 12) score += 2.4;
  else if (count >= 8) score += 1.8;
  else if (count >= 5) score += 1.2;
  else if (count >= 2) score += 0.7;
  else if (count >= 1) score += 0.3;

  if (outfit.pricedCount >= 5) score += 0.6;
  else if (outfit.pricedCount >= 2) score += 0.4;
  else if (outfit.pricedCount >= 1) score += 0.2;

  if (outfit.items.some((i) => i.isLimited)) score += 0.6;
  else if (outfit.totalMarketValue != null) score += 0.2;

  return clamp(score, 0, 4);
}

function socialScore(social, hasVerifiedBadge) {
  const followers = socialValue(social.followers);
  const friends = socialValue(social.friends);
  let score = 0;
  if (followers != null && followers > 0) {
    score += clamp((Math.log10(followers + 1) / 7) * 2.1, 0, 2.1);
  }
  if (friends != null && friends > 0) {
    score += clamp((Math.log10(friends + 1) / 3.5) * 0.7, 0, 0.7);
  }
  if (hasVerifiedBadge) score += 0.2;
  return clamp(score, 0, 3);
}

function profileScore(dataset) {
  let score = 0;
  const age = dataset.accountAgeDays;
  if (age != null) {
    if (age >= 3650) score += 1.2;
    else if (age >= 1825) score += 1;
    else if (age >= 730) score += 0.8;
    else if (age >= 180) score += 0.5;
    else score += 0.2;
  }
  if (dataset.isPremium) score += 0.2;
  if (dataset.displayName && dataset.displayName.toLowerCase() !== dataset.username.toLowerCase()) score += 0.2;
  return clamp(score, 0, 2);
}

function neatnessScore(outfit) {
  const categories = new Set(outfit.items.map((i) => i.category).filter(Boolean));
  const distinct = categories.size;
  if (outfit.itemCount === 0) return 0.3;
  if (distinct >= 4) return 1;
  if (distinct === 3) return 0.8;
  if (distinct === 2) return 0.6;
  return 0.4;
}

function verdictFor(score) {
  if (score >= 9) return { label: 'LUAR BIASA', line: 'Ini level kolektor, serius.' };
  if (score >= 8) return { label: 'KEREN', line: 'Outfit-nya rapi dan niat.' };
  if (score >= 7) return { label: 'BAGUS', line: 'Ada gaya, tinggal satu dua sentuhan.' };
  if (score >= 5.5) return { label: 'LUMAYAN', line: 'Masih aman, belum bikin orang menoleh.' };
  if (score >= 4) return { label: 'STANDAR', line: 'Simpel, tidak berlebihan.' };
  return { label: 'HEMAT', line: 'Gaya minim, tapi dompet aman.' };
}

/**
 * @param {object} dataset hasil fetchAccount
 * @returns {{score:number, breakdown:object, verdict:object, stats:object, display:object}}
 */
export function analyzeAccount(dataset) {
  const outfit = dataset.outfit;
  const breakdown = {
    outfit: Number(outfitScore(outfit).toFixed(2)),
    social: Number(socialScore(dataset.social, dataset.hasVerifiedBadge).toFixed(2)),
    profile: Number(profileScore(dataset).toFixed(2)),
    neatness: Number(neatnessScore(outfit).toFixed(2)),
  };
  const rawScore = breakdown.outfit + breakdown.social + breakdown.profile + breakdown.neatness;
  const score = Number(clamp(rawScore, 0, 10).toFixed(1));
  const verdict = verdictFor(score);

  const topCategory = (() => {
    const counts = new Map();
    for (const item of outfit.items) {
      if (!item.category) continue;
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    let best = null;
    for (const [name, n] of counts) if (!best || n > best.count) best = { name, count: n };
    return best;
  })();

  const stats = {
    score,
    outfitItems: outfit.itemCount,
    outfitPriced: outfit.pricedCount,
    outfitUnpriced: outfit.unpricedCount,
    outfitValue: outfit.totalMarketValue,
    mostExpensive: outfit.mostExpensive,
    cheapest: outfit.cheapest,
    limitedCount: dataset.collectibles.status === 'ok' ? dataset.collectibles.count : null,
    limitedTruncated: !!dataset.collectibles.truncated,
    limitedRap: dataset.collectibles.rapTotal,
    limitedTop: dataset.collectibles.mostExpensive,
    friends: socialValue(dataset.social.friends),
    followers: socialValue(dataset.social.followers),
    following: socialValue(dataset.social.following),
    accountAgeDays: dataset.accountAgeDays,
    accountAgeYears: dataset.accountAgeDays == null ? null : Number((dataset.accountAgeDays / 365).toFixed(1)),
    topCategory,
    bundleCount: dataset.bundles.status === 'ok' ? dataset.bundles.count : null,
  };

  // String siap tampil di layar (angka berformat Indonesia).
  const display = {
    outfitValue: stats.outfitValue == null ? 'Unavailable' : `${formatNumberId(stats.outfitValue)} Robux`,
    limitedRap: stats.limitedRap == null ? 'Unavailable' : `${formatNumberId(stats.limitedRap)} Robux`,
    friends: stats.friends == null ? 'Unavailable' : formatNumberId(stats.friends),
    followers: stats.followers == null ? 'Unavailable' : formatNumberId(stats.followers),
    following: stats.following == null ? 'Unavailable' : formatNumberId(stats.following),
    mostExpensive: stats.mostExpensive ? `${stats.mostExpensive.name} (${formatNumberId(stats.mostExpensive.price)} Robux)` : null,
    score: score.toFixed(1),
    verdict: verdict.label,
  };

  return { score, breakdown, verdict, stats, display };
}
