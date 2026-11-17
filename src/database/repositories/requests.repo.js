// Repository: permintaan review, antrean, pembayaran, dan gift.

import { all, get, nowIso, run } from '../db.js';

const UPDATABLE = [
  'roblox_user_id',
  'package',
  'priority',
  'status',
  'payment_status',
  'note',
  'error',
  'enqueued_at',
  'started_at',
  'completed_at',
];

export function createRequest(input) {
  const now = nowIso();
  const result = run(
    `INSERT INTO requests (tiktok_user, roblox_username, roblox_user_id, package, priority, status,
                           payment_status, source, message_id, note, created_at, enqueued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.tiktokUser ?? null,
    input.robloxUsername,
    input.robloxUserId ?? null,
    input.package,
    input.priority,
    input.status ?? 'waiting',
    input.paymentStatus ?? 'not_required',
    input.source ?? 'manual',
    input.messageId ?? null,
    input.note ?? null,
    now,
    input.status === 'pending_verification' ? null : now,
  );
  return getRequest(Number(result.lastInsertRowid));
}

export function getRequest(id) {
  return get('SELECT * FROM requests WHERE id = ?', Number(id));
}

export function findRequestByMessageId(messageId) {
  return get('SELECT * FROM requests WHERE message_id = ?', messageId);
}

export function updateRequest(id, patch) {
  const fields = Object.keys(patch).filter((key) => UPDATABLE.includes(key));
  if (fields.length === 0) return getRequest(id);
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  run(`UPDATE requests SET ${sets} WHERE id = ?`, ...fields.map((f) => patch[f]), Number(id));
  return getRequest(id);
}

/** Semua permintaan yang menunggu, urut prioritas tertinggi lalu FIFO. */
export function listWaiting() {
  return all(
    `SELECT * FROM requests
     WHERE status = 'waiting'
     ORDER BY priority DESC, enqueued_at ASC, id ASC`,
  );
}

export function listByStatus(statuses, limit = 100) {
  if (statuses.length === 0) return all('SELECT * FROM requests ORDER BY id DESC LIMIT ?', limit);
  const marks = statuses.map(() => '?').join(', ');
  return all(`SELECT * FROM requests WHERE status IN (${marks}) ORDER BY id DESC LIMIT ?`, ...statuses, limit);
}

export function listRecent(limit = 50) {
  return all(
    `SELECT r.*, p.status AS payment_verification, p.txn_code
     FROM requests r
     LEFT JOIN payments p ON p.request_id = r.id
     ORDER BY r.id DESC
     LIMIT ?`,
    limit,
  );
}

/** Permintaan aktif (belum selesai/gagal) milik satu user TikTok. */
export function countActiveByTiktokUser(tiktokUser) {
  const row = get(
    `SELECT COUNT(*) AS n FROM requests
     WHERE lower(tiktok_user) = lower(?)
       AND status IN ('waiting','processing','generating_audio','playing','pending_verification')`,
    tiktokUser,
  );
  return row?.n ?? 0;
}

export function findRecentDuplicate(tiktokUser, robloxUsername, sinceIso) {
  return get(
    `SELECT * FROM requests
     WHERE lower(tiktok_user) = lower(?) AND lower(roblox_username) = lower(?) AND created_at >= ?
     ORDER BY id DESC LIMIT 1`,
    tiktokUser,
    robloxUsername,
    sinceIso,
  );
}

/**
 * Request yang SUDAH masuk antrean milik satu user TikTok (untuk upgrade prioritas lewat gift).
 * Request yang pembayarannya belum diverifikasi sengaja tidak ikut: gift tidak boleh
 * mengubah paket yang status pembayarannya masih menggantung.
 */
export function findLatestActiveByTiktokUser(tiktokUser) {
  return get(
    `SELECT * FROM requests
     WHERE lower(tiktok_user) = lower(?)
       AND status = 'waiting'
     ORDER BY id DESC LIMIT 1`,
    tiktokUser,
  );
}

export function findLatestForUser(robloxUsername, statuses) {
  const marks = statuses.map(() => '?').join(', ');
  return get(
    `SELECT * FROM requests WHERE lower(roblox_username) = lower(?) AND status IN (${marks}) ORDER BY id DESC LIMIT 1`,
    robloxUsername,
    ...statuses,
  );
}

/**
 * Saat start: pekerjaan yang terputus dikembalikan ke antrean, bukan dianggap selesai.
 * Request berstatus 'generating_audio' yang sudah punya file audio TIDAK diulang —
 * biarkan speech queue memutarnya — supaya restart tidak memicu TTS ulang.
 */
export function recoverInterrupted() {
  const now = nowIso();
  const interrupted = all(
    `SELECT id FROM requests
     WHERE status IN ('processing','playing')
        OR (status = 'generating_audio' AND id NOT IN (
          SELECT request_id FROM speech_jobs WHERE audio_path IS NOT NULL AND status IN ('queued','playing')
        ))`,
  );
  run(`UPDATE requests SET status = 'waiting', started_at = NULL, error = 'Dipulihkan setelah restart'
       WHERE status IN ('processing','playing')`);
  run(`UPDATE requests SET status = 'waiting', started_at = NULL, error = 'Dipulihkan setelah restart'
       WHERE status = 'generating_audio' AND id NOT IN (
         SELECT request_id FROM speech_jobs WHERE audio_path IS NOT NULL AND status IN ('queued','playing')
       )`);
  run(`UPDATE speech_jobs SET status = 'queued', error = 'Dipulihkan setelah restart' WHERE status = 'playing'`);
  if (interrupted.length > 0) {
    run(
      `UPDATE requests SET enqueued_at = COALESCE(enqueued_at, ?) WHERE id IN (${interrupted.map(() => '?').join(',')})`,
      now,
      ...interrupted.map((r) => r.id),
    );
  }
  return interrupted.length;
}

export function stats() {
  const rows = all('SELECT status, COUNT(*) AS n FROM requests GROUP BY status');
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const totals = get(
    `SELECT
       (SELECT COUNT(*) FROM requests) AS total_requests,
       (SELECT COUNT(*) FROM requests WHERE status = 'completed') AS completed,
       (SELECT COALESCE(SUM(amount_idr),0) FROM payments WHERE status = 'verified') AS revenue_idr,
       (SELECT COUNT(*) FROM gifts) AS gifts,
       (SELECT COALESCE(SUM(diamonds),0) FROM gifts) AS diamonds`,
  );
  return { ...totals, byStatus };
}

// ---------------------------------------------------------------- payments

export function createPayment({ requestId, packageId, amountIdr, method = 'manual', txnCode = null, status = 'pending', note = null }) {
  run(
    `INSERT INTO payments (request_id, package, amount_idr, method, txn_code, status, note, created_at, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Number(requestId),
    packageId,
    amountIdr,
    method,
    txnCode,
    status,
    note,
    nowIso(),
    status === 'verified' ? nowIso() : null,
  );
  return getPaymentByRequest(requestId);
}

export function getPaymentByRequest(requestId) {
  return get('SELECT * FROM payments WHERE request_id = ?', Number(requestId));
}

export function setPaymentStatus(requestId, status, note) {
  run(
    'UPDATE payments SET status = ?, note = COALESCE(?, note), verified_at = ? WHERE request_id = ?',
    status,
    note ?? null,
    status === 'verified' ? nowIso() : null,
    Number(requestId),
  );
  return getPaymentByRequest(requestId);
}

export function listPendingPayments() {
  return all(
    `SELECT p.*, r.roblox_username, r.tiktok_user, r.status AS request_status
     FROM payments p JOIN requests r ON r.id = p.request_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at ASC`,
  );
}

// ------------------------------------------------------------------- gifts

export function logGift({ requestId = null, tiktokUser, giftId, giftName, diamonds = 0, repeatCount = 1, tier = null }) {
  run(
    `INSERT INTO gifts (request_id, tiktok_user, gift_id, gift_name, diamonds, repeat_count, tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    requestId,
    tiktokUser ?? null,
    String(giftId),
    giftName ?? null,
    diamonds,
    repeatCount,
    tier,
    nowIso(),
  );
  return get('SELECT * FROM gifts ORDER BY id DESC LIMIT 1');
}

export function listGifts(limit = 30) {
  return all('SELECT * FROM gifts ORDER BY id DESC LIMIT ?', limit);
}

export function giftTotals() {
  return get('SELECT COUNT(*) AS count, COALESCE(SUM(diamonds),0) AS diamonds FROM gifts');
}
