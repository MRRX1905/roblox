// API untuk dashboard: snapshot keadaan, statistik, log, dan SSE.

import { Router } from 'express';
import { getOverlayState, subscribeSse } from '../services/events.service.js';
import { stats, listRecent } from '../database/repositories/requests.repo.js';
import { getSpeechState } from '../services/speech-queue.service.js';
import { getTikTokStatus } from '../services/tiktok.service.js';
import { getWorkerState } from '../services/worker.service.js';
import { getSettings } from '../services/settings.service.js';
import { logger } from '../lib/logger.js';
import { clientCount } from '../services/events.service.js';
import { refreshQueueState } from '../services/queue.service.js';
import { pendingSpeechCount } from '../database/repositories/reviews.repo.js';

export const dashboardRouter = Router();

dashboardRouter.get('/health', (req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()), sseClients: clientCount() });
});

dashboardRouter.get('/state', (req, res) => {
  refreshQueueState();
  res.json({
    ...getOverlayState(),
    tiktok: getTikTokStatus(),
    speech: { ...getSpeechState(), pending: pendingSpeechCount() },
    worker: getWorkerState(),
    stats: stats(),
    settings: getSettings(),
    recent: listRecent(15),
    logs: logger.recent(40),
  });
});

dashboardRouter.get('/stats', (req, res) => {
  res.json(stats());
});

dashboardRouter.get('/logs', (req, res) => {
  res.json({ logs: logger.recent(Number(req.query.limit ?? 100)) });
});

dashboardRouter.get('/events', (req, res) => {
  subscribeSse(req, res);
});
