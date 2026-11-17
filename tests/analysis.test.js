import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAccount } from '../src/services/analysis.service.js';
import { buildTemplateNarration } from '../src/services/narration.service.js';

export function makeDataset(overrides = {}) {
  const base = {
    fetchedAt: new Date().toISOString(),
    username: 'Rafixx123',
    userId: 42,
    displayName: 'Rafi',
    description: null,
    created: '2019-01-01T00:00:00Z',
    accountAgeDays: 2000,
    hasVerifiedBadge: false,
    isPremium: false,
    avatar: { source: 'v4', images: { full: null, headshot: null, bust: null }, itemCount: 6, outfitCount: 6, technicalCount: 0 },
    social: {
      friends: { status: 'ok', value: 245 },
      followers: { status: 'ok', value: 1200 },
      following: { status: 'ok', value: 40 },
    },
    outfit: {
      items: [
        { assetId: 1, name: 'Black Hair', category: 'Hair', price: 75, marketPrice: 75, isLimited: false },
        { assetId: 2, name: 'Red Jacket', category: 'Shirt', price: 120, marketPrice: 120, isLimited: false },
        { assetId: 3, name: 'Dark Glasses', category: 'FaceAccessory', price: 50, marketPrice: 50, isLimited: false },
      ],
      itemCount: 3,
      pricedCount: 3,
      unpricedCount: 0,
      totalMarketValue: 245,
      mostExpensive: { name: 'Red Jacket', price: 120 },
      cheapest: { name: 'Dark Glasses', price: 50 },
    },
    collectibles: { status: 'ok', count: 2, truncated: false, pricedCount: 2, rapTotal: 5000, mostExpensive: { name: 'Crown', price: 4000 }, items: [] },
    bundles: { status: 'ok', count: 1, items: [] },
    dataQuality: { partial: false, missing: [], notes: [] },
  };
  return { ...base, ...overrides };
}

test('rating berada di 0-10 dengan breakdown', () => {
  const result = analyzeAccount(makeDataset());
  assert.ok(result.score >= 0 && result.score <= 10);
  assert.equal(result.score, Number(result.score.toFixed(1)));
  assert.deepEqual(Object.keys(result.breakdown).sort(), ['neatness', 'outfit', 'profile', 'social']);
});

test('data yang hilang ditampilkan Unavailable, bukan 0', () => {
  const dataset = makeDataset({
    social: {
      friends: { status: 'unavailable', value: null, reason: '429' },
      followers: { status: 'unavailable', value: null, reason: '429' },
      following: { status: 'unavailable', value: null, reason: '429' },
    },
    outfit: { ...makeDataset().outfit, totalMarketValue: null, pricedCount: 0 },
    collectibles: { status: 'private', count: 0, truncated: false, rapTotal: null, items: [], pricedCount: 0 },
  });
  const result = analyzeAccount(dataset);
  assert.equal(result.display.friends, 'Unavailable');
  assert.equal(result.display.followers, 'Unavailable');
  assert.equal(result.display.outfitValue, 'Unavailable');
  assert.equal(result.display.limitedRap, 'Unavailable');
  assert.equal(result.stats.limitedCount, null, 'inventory privat bukan berarti 0 Limited');
});

test('nilai outfit dan RAP tidak digabung jadi satu angka', () => {
  const result = analyzeAccount(makeDataset());
  assert.equal(result.stats.outfitValue, 245);
  assert.equal(result.stats.limitedRap, 5000);
  assert.notEqual(result.display.outfitValue, result.display.limitedRap);
});

test('narasi memakai angka dari analisis dan bebas digit saat dibacakan', () => {
  const dataset = makeDataset();
  const analysis = analyzeAccount(dataset);
  const narration = buildTemplateNarration(dataset, analysis, { packageId: 'full' });
  assert.match(narration.text, /245 Robux/);
  assert.match(narration.text, /8|7|6|5|4/, 'skor muncul di naskah');
  // Username sendiri boleh mengandung digit (Rafixx123); selain itu tidak boleh ada digit
  // yang tersisa, karena angka harus sudah dieja untuk TTS.
  const speechWithoutUsername = narration.speech.split(dataset.username).join('');
  assert.equal(/\d/.test(speechWithoutUsername), false, 'angka di naskah TTS harus sudah dieja');
  assert.match(narration.speech, /dua ratus empat puluh lima Robux/);
  assert.match(narration.speech, /Rafixx123/, 'username tidak boleh berubah jadi kata angka');
  assert.ok(narration.meta.words >= 60, `naskah terlalu pendek: ${narration.meta.words} kata`);
});

test('narasi memakai kata "Unavailable" bila harga tidak tersedia', () => {
  const dataset = makeDataset({
    outfit: { ...makeDataset().outfit, totalMarketValue: null, pricedCount: 0, unpricedCount: 3, items: [] },
  });
  const analysis = analyzeAccount(dataset);
  const narration = buildTemplateNarration(dataset, analysis, { packageId: 'full' });
  assert.match(narration.text, /tidak tersedia publik/i);
  const speechWithoutUsername = narration.speech.split(dataset.username).join('');
  assert.equal(/\d/.test(speechWithoutUsername), false);
});
