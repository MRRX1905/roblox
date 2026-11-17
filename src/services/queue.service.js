// Antrean berprioritas + aturan fairness.
//
// Prioritas: VIP 100, Fast Track 50, Full 40, Normal 10 (dari config/pricing.js).
// Seri -> FIFO. Fairness: maksimal N pekerjaan prioritas berturut-turut,
// lalu satu pekerjaan normal dilayani supaya penonton gratis tidak menunggu selamanya.

import {
  countActiveByTiktokUser,
  createPayment,
  createRequest,
  findRecentDuplicate,
  findRequestByMessageId,
  getRequest,
  listByStatus,
  listWaiting,
  setPaymentStatus,
  updateRequest,
} from '../database/repositories/requests.repo.js';
import { getPackage, requiresPayment } from '../config/pricing.js';
import { getSettings } from './settings.service.js';
import { logger } from '../lib/logger.js';
import * as events from './events.service.js';

let consecutivePriority = 0;

export class QueueError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
  }
}

/**
 * @returns {{request: object, queued: boolean, message: string}}
 */
export function enqueueRequest({
  tiktokUser = null,
  robloxUsername,
  packageId = 'quick',
  source = 'manual',
  messageId = null,
  note = null,
  txnCode = null,
}) {
  const pkg = getPackage(packageId);
  const settings = getSettings();

  if (tiktokUser) {
    const cooldownMs = (settings.tiktok.cooldownSeconds ?? 60) * 1000;
    const since = new Date(Date.now() - cooldownMs).toISOString();
    const recent = findRecentDuplicate(tiktokUser, robloxUsername, since);
    if (recent) {
      throw new QueueError(
        `Sabar ya, ${tiktokUser}. Akun ${robloxUsername} baru saja dimasukkan. Coba lagi beberapa saat.`,
        'COOLDOWN',
      );
    }
    const active = countActiveByTiktokUser(tiktokUser);
    if (active >= (settings.tiktok.maxActivePerUser ?? 1)) {
      throw new QueueError(
        `${tiktokUser}, masih ada review aktif atas namamu. Tunggu sampai selesai ya.`,
        'TOO_MANY_ACTIVE',
      );
    }
  }

  const needsPayment = requiresPayment(pkg.id);
  const status = needsPayment ? 'pending_verification' : 'waiting';
  let request;
  try {
    request = createRequest({
      tiktokUser,
      robloxUsername,
      package: pkg.id,
      priority: pkg.priority,
      status,
      paymentStatus: needsPayment ? 'pending' : 'not_required',
      source,
      messageId,
      note,
    });
  } catch (err) {
    // Index unik pada message_id: event yang sama tidak boleh membuat request kedua.
    if (/UNIQUE/i.test(err.message) && messageId) {
      const existing = findRequestByMessageId(messageId);
      if (existing) return { request: existing, queued: false, message: 'Event ini sudah pernah diproses' };
    }
    throw err;
  }

  if (needsPayment) {
    createPayment({
      requestId: request.id,
      packageId: pkg.id,
      amountIdr: pkg.priceIdr,
      method: 'manual',
      txnCode,
      status: 'pending',
      note: txnCode ? `Kode transaksi: ${txnCode}` : 'Menunggu kode transaksi',
    });
  }

  logger.info('Request masuk antrean', {
    id: request.id,
    username: robloxUsername,
    package: pkg.id,
    priority: pkg.priority,
    status,
    source,
  });
  refreshQueueState();

  return {
    request,
    queued: !needsPayment,
    message: needsPayment
      ? `Paket ${pkg.label} menunggu verifikasi pembayaran (${pkg.priceIdr ? `Rp${pkg.priceIdr.toLocaleString('id-ID')}` : 'gift'}).`
      : `Masuk antrean sebagai ${pkg.label}.`,
  };
}

/**
 * Ambil (claim) pekerjaan berikutnya, menghormati fairness.
 * Request langsung berubah ke 'processing' supaya tidak diambil dua kali.
 */
export function nextRequest() {
  const waiting = listWaiting();
  if (waiting.length === 0) return null;

  const maxConsecutive = getSettings().queue?.maxConsecutivePriority ?? 2;
  const normal = waiting.find((r) => r.priority <= 10);

  let picked;
  if (normal && consecutivePriority >= maxConsecutive) {
    consecutivePriority = 0;
    picked = normal;
    logger.info('Fairness: melayani satu antrean normal', { requestId: normal.id });
  } else {
    picked = waiting[0];
    consecutivePriority = picked.priority > 10 ? consecutivePriority + 1 : 0;
  }

  return updateRequest(picked.id, { status: 'processing', started_at: new Date().toISOString() });
}

export function resetFairness() {
  consecutivePriority = 0;
}

export function refreshQueueState() {
  const waiting = listWaiting();
  events.updateState({
    queue: waiting.slice(0, 20).map((r, index) => ({
      position: index + 1,
      id: r.id,
      username: r.roblox_username,
      tiktokUser: r.tiktok_user,
      package: r.package,
      priority: r.priority,
      status: r.status,
    })),
  });
  return waiting;
}

export function approvePayment(requestId, { adminNote = null } = {}) {
  const request = getRequest(requestId);
  if (!request) throw new QueueError('Request tidak ditemukan', 'NOT_FOUND');
  if (request.status !== 'pending_verification') {
    throw new QueueError(`Request #${requestId} berstatus ${request.status}, bukan menunggu verifikasi`, 'NOT_PENDING');
  }
  const pkg = getPackage(request.package);
  updateRequest(requestId, {
    status: 'waiting',
    payment_status: 'verified',
    enqueued_at: new Date().toISOString(),
    note: adminNote ?? request.note,
  });
  setPaymentStatus(requestId, 'verified', adminNote ?? 'Diverifikasi admin');
  logger.info('Pembayaran diverifikasi admin', { requestId, package: pkg.id });
  refreshQueueState();
  return getRequest(requestId);
}

export function rejectPayment(requestId, { reason = 'Pembayaran tidak ditemukan' } = {}) {
  const request = getRequest(requestId);
  if (!request) throw new QueueError('Request tidak ditemukan', 'NOT_FOUND');
  updateRequest(requestId, {
    status: 'cancelled',
    payment_status: 'rejected',
    error: reason,
    completed_at: new Date().toISOString(),
  });
  setPaymentStatus(requestId, 'rejected', reason);
  logger.info('Pembayaran ditolak admin', { requestId, reason });
  return getRequest(requestId);
}

export function retryRequest(requestId) {
  const request = getRequest(requestId);
  if (!request) throw new QueueError('Request tidak ditemukan', 'NOT_FOUND');
  if (!['failed', 'cancelled'].includes(request.status)) {
    throw new QueueError(`Request #${requestId} berstatus ${request.status}; hanya failed/cancelled yang bisa diulang`, 'BAD_STATUS');
  }
  updateRequest(requestId, {
    status: 'waiting',
    error: null,
    enqueued_at: new Date().toISOString(),
    completed_at: null,
  });
  logger.info('Request diulang admin', { requestId });
  refreshQueueState();
  return getRequest(requestId);
}

export function cancelRequest(requestId) {
  const request = getRequest(requestId);
  if (!request) throw new QueueError('Request tidak ditemukan', 'NOT_FOUND');
  updateRequest(requestId, {
    status: 'cancelled',
    completed_at: new Date().toISOString(),
    note: 'Dibatalkan admin',
  });
  refreshQueueState();
  return getRequest(requestId);
}

export function pendingVerifications() {
  return listByStatus(['pending_verification'], 50);
}
