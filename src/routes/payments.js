// API pembayaran manual (verifikasi oleh admin di dashboard).

import { Router } from 'express';
import { approvePayment, pendingVerifications, rejectPayment } from '../services/queue.service.js';
import { listPendingPayments } from '../database/repositories/requests.repo.js';

export const paymentsRouter = Router();

paymentsRouter.get('/pending', (req, res) => {
  res.json({
    requests: pendingVerifications(),
    payments: listPendingPayments(),
  });
});

paymentsRouter.post('/:requestId/approve', (req, res, next) => {
  try {
    res.json({ request: approvePayment(Number(req.params.requestId), { adminNote: req.body?.note ?? null }) });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post('/:requestId/reject', (req, res, next) => {
  try {
    res.json({ request: rejectPayment(Number(req.params.requestId), { reason: req.body?.reason }) });
  } catch (err) {
    next(err);
  }
});
