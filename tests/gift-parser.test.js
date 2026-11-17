import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGiftEvent, shouldProcessGift } from '../src/integrations/tiktok/gift-parser.js';

const mapping = { '5655': 'fast_track', '9999': 'vip_express' };

function gift(overrides = {}) {
  return {
    type: 'gift',
    msgId: 'm1',
    giftId: 5655,
    giftName: 'Rose',
    diamondCount: 1,
    repeatCount: 3,
    totalDiamonds: 3,
    streaking: false,
    user: { uniqueId: 'rafi_live', nickname: 'Rafi' },
    ...overrides,
  };
}

test('gift dengan combo selesai diproses', () => {
  const normalized = normalizeGiftEvent(gift(), mapping);
  assert.equal(normalized.isFinal, true);
  assert.equal(normalized.packageId, 'fast_track');
  assert.equal(normalized.tiktokUser, 'rafi_live');
  assert.equal(normalized.totalDiamonds, 3);
  assert.equal(shouldProcessGift(normalized), true);
});

test('gift streaking diabaikan sampai combo selesai', () => {
  const normalized = normalizeGiftEvent(gift({ streaking: true }), mapping);
  assert.equal(normalized.isFinal, false);
  assert.equal(shouldProcessGift(normalized), false);
});

test('gift yang belum dipetakan tidak memberi paket', () => {
  const normalized = normalizeGiftEvent(gift({ giftId: 12345 }), mapping);
  assert.equal(normalized.packageId, null);
  assert.equal(shouldProcessGift(normalized), false);
});

test('diamond tidak pernah dipakai sebagai harga', () => {
  const normalized = normalizeGiftEvent(gift({ diamondCount: 100, repeatCount: 1, totalDiamonds: 100 }), mapping);
  assert.equal(normalized.diamondCount, 100);
  assert.equal(Object.hasOwn(normalized, 'priceIdr'), false);
});
