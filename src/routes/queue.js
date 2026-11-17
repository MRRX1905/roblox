// API antrean: lihat, tambah manual, approve/reject pembayaran, retry, cancel.

import { Router } from 'express';
import {
  approvePayment,
  cancelRequest,
  enqueueRequest,
  pendingVerifications,
  rejectPayment,
  refreshQueueState,
  retryRequest,
} from '../services/queue.service.js';
import { listByStatus, listWaiting } from '../database/repositories/requests.repo.js';
import { getPackage, PACKAGES } from '../config/pricing.js';

export const queueRouter = Router();

queueRouter.get('/', (req, res) => {
  res.json({
    waiting: listWaiting(),
    active: listByStatus(['processing', 'generating_audio', 'playing'], 20),
    pendingPayment: pendingVerifications(),
    packages: Object.values(PACKAGES).map((p) => ({
      id: p.id,
      label: p.label,
      priceIdr: p.priceIdr,
      priority: p.priority,
      benefits: p.benefits,
    })),
  });
});

queueRouter.post('/', (req, res, next) => {
  try {
    const { username, packageId = 'quick', tiktokUser = null, txnCode = null } = req.body ?? {};
    if (!username) return res.status(400).json({ error: 'username wajib diisi' });
    getPackage(packageId);
    const result = enqueueRequest({
      robloxUsername: String(username).trim(),
      packageId,
      tiktokUser: tiktokUser ? String(tiktokUser).trim() : null,
      source: 'manual',
      txnCode: txnCode ? String(txnCode).trim() : null,
      note: 'Dimasukkan manual oleh admin',
    });
    return res.status(201).json({ request: result.request, queued: result.queued, message: result.message });
  } catch (err) {
    return next(err);
  }
});

queueRouter.post('/:id/approve', (req, res, next) => {
  try {
    const request = approvePayment(Number(req.params.id), { adminNote: req.body?.note ?? null });
    refreshQueueState();
    res.json({ request, message: 'Pembayaran diverifikasi, request masuk antrean' });
  } catch (err) {
    next(err);
  }
});

queueRouter.post('/:id/reject', (req, res, next) => {
  try {
    const request = rejectPayment(Number(req.params.id), { reason: req.body?.reason ?? 'Pembayaran tidak ditemukan' });
    refreshQueueState();
    res.json({ request, message: 'Pembayaran ditolak' });
  } catch (err) {
    next(err);
  }
});

queueRouter.post('/:id/retry', (req, res, next) => {
  try {
    res.json({ request: retryRequest(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

queueRouter.post('/:id/cancel', (req, res, next) => {
  try {
    res.json({ request: cancelRequest(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});
