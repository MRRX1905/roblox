import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'rlr-test-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = join(dir, 'test.sqlite');

const { enqueueRequest, nextRequest, approvePayment, rejectPayment, retryRequest, resetFairness } = await import(
  '../src/services/queue.service.js'
);
const { getRequest, updateRequest, listWaiting } = await import('../src/database/repositories/requests.repo.js');
const { nextSpeakableJob } = await import('../src/database/repositories/reviews.repo.js');
const { closeDb } = await import('../src/database/db.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('antrean mengikuti prioritas paket', () => {
  resetFairness();
  const a = enqueueRequest({ robloxUsername: 'UserA', packageId: 'quick', source: 'manual' }).request;
  const b = enqueueRequest({ robloxUsername: 'UserB', packageId: 'vip_express', source: 'manual', txnCode: 'VIP-1' });
  // VIP butuh verifikasi dulu, jadi belum masuk antrean.
  assert.equal(b.request.status, 'pending_verification');
  approvePayment(b.request.id);
  assert.equal(nextRequest().id, b.request.id, 'VIP dilayani lebih dulu');
  assert.equal(nextRequest().id, a.id);
  assert.equal(nextRequest(), null);
});

test('fairness: dua prioritas berturut-turut lalu satu normal', () => {
  resetFairness();
  const normal = enqueueRequest({ robloxUsername: 'FreeUser', packageId: 'quick', source: 'manual' }).request;
  const vip = enqueueRequest({ robloxUsername: 'VipUser', packageId: 'vip_express', source: 'manual' }).request;
  const fast = enqueueRequest({ robloxUsername: 'FastUser', packageId: 'fast_track', source: 'manual' }).request;

  // VIP masih pending verifikasi; fast_track gratis dan sudah masuk antrean.
  approvePayment(vip.id);

  const order = [nextRequest()?.id, nextRequest()?.id, nextRequest()?.id];
  assert.deepEqual(order, [vip.id, fast.id, normal.id], 'setelah dua prioritas, user gratis dilayani');
});

test('paket berbayar tanpa verifikasi tidak masuk antrean', () => {
  const pending = enqueueRequest({ robloxUsername: 'PendingUser', packageId: 'full', source: 'chat', txnCode: 'TRX-1' }).request;
  assert.equal(pending.status, 'pending_verification');
  assert.equal(listWaiting().some((r) => r.id === pending.id), false, 'belum terverifikasi tidak boleh masuk antrean');
});

test('pembayaran ditolak -> request cancelled dan tidak diantrekan', () => {
  const req = enqueueRequest({ robloxUsername: 'RejectUser', packageId: 'vip_express', source: 'chat', txnCode: 'TRX-2' }).request;
  rejectPayment(req.id, { reason: 'Kode transaksi tidak ditemukan' });
  const after = getRequest(req.id);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.payment_status, 'rejected');
});

test('cooldown mencegah spam username yang sama', () => {
  enqueueRequest({ tiktokUser: 'spammer', robloxUsername: 'SpamTarget', packageId: 'quick', source: 'chat' });
  assert.throws(
    () => enqueueRequest({ tiktokUser: 'spammer', robloxUsername: 'SpamTarget', packageId: 'quick', source: 'chat' }),
    /Sabar ya/,
  );
});

test('retry mengembalikan request gagal ke antrean tanpa membuat pembayaran baru', () => {
  const req = enqueueRequest({ robloxUsername: 'RetryUser', packageId: 'quick', source: 'manual' }).request;
  updateRequest(req.id, { status: 'failed', error: 'jaringan mati' });
  const retried = retryRequest(req.id);
  assert.equal(retried.status, 'waiting');
  assert.equal(retried.error, null);
});

test('tidak ada audio yang siap diputar sebelum TTS dibuat', () => {
  assert.equal(nextSpeakableJob(), undefined);
});

test('recovery: processing kembali ke waiting, audio yang sudah jadi dipertahankan', async () => {
  const { recoverInterrupted, createRequest } = await import('../src/database/repositories/requests.repo.js');
  const { createSpeechJob } = await import('../src/database/repositories/reviews.repo.js');

  const interrupted = createRequest({ robloxUsername: 'CrashUser', package: 'quick', priority: 10, status: 'processing', source: 'manual' });
  const audioReady = createRequest({ robloxUsername: 'AudioUser', package: 'quick', priority: 10, status: 'generating_audio', source: 'manual' });
  createSpeechJob({ requestId: audioReady.id, voice: 'id-ID-ArdiNeural', audioPath: '/tmp/fake.wav' });
  const stuck = createRequest({ robloxUsername: 'StuckUser', package: 'quick', priority: 10, status: 'generating_audio', source: 'manual' });

  const recovered = recoverInterrupted();
  assert.ok(recovered >= 2, 'request terputus dilaporkan');
  assert.equal(getRequest(interrupted.id).status, 'waiting');
  assert.equal(getRequest(audioReady.id).status, 'generating_audio', 'audio siap tidak boleh di-TTS ulang');
  assert.equal(getRequest(stuck.id).status, 'waiting', 'generating_audio tanpa file harus diulang');
});
