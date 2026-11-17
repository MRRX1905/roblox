// Bootstrap: database, services, routes, static dashboard/overlay.

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from './database/db.js';
import { recoverInterrupted } from './database/repositories/requests.repo.js';
import { startWorker, stopWorker } from './services/worker.service.js';
import { startSpeechQueue, stopSpeechQueue } from './services/speech-queue.service.js';
import { stopTikTok } from './services/tiktok.service.js';
import { refreshQueueState } from './services/queue.service.js';
import { getSettings } from './services/settings.service.js';
import { dashboardRouter } from './routes/dashboard.js';
import { queueRouter } from './routes/queue.js';
import { reviewRouter } from './routes/review.js';
import { audioRouter } from './routes/audio.js';
import { settingsRouter } from './routes/settings.js';
import { tiktokRouter } from './routes/tiktok.js';
import { paymentsRouter } from './routes/payments.js';
import { overlayRouter } from './routes/overlay.js';
import { QueueError } from './services/queue.service.js';
import { logger } from './lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
// Sebagian lingkungan mengekspor PORT=0; itu bukan port yang bisa dipakai.
const rawPort = Number(process.env.PORT);
const PORT = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3210;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

// Server ini hanya untuk localhost, tapi halaman web lain di browser yang sama
// tetap bisa mengirim POST ke 127.0.0.1. Tolak mutasi lintas-origin.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    if (host === req.get('host')) return next();
  } catch {
    // Origin rusak dianggap lintas-origin
  }
  logger.warn('Mutasi lintas-origin ditolak', { origin, path: req.path });
  return res.status(403).json({ error: 'Origin tidak diizinkan' });
});

app.use('/api', dashboardRouter);
app.use('/api/queue', queueRouter);
app.use('/api/review', reviewRouter);
app.use('/api/audio', audioRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tiktok', tiktokRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/overlay', overlayRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const code = err.code ?? 'INTERNAL';
  let status = 500;
  if (code === 'INVALID_USERNAME' || code === 'UNKNOWN_PACKAGE' || code === 'UNKNOWN_SETTING' || code === 'USERNAME_INVALID') {
    status = 400;
  } else if (code === 'USER_NOT_FOUND' || code === 'NOT_FOUND') status = 404;
  else if (err instanceof QueueError || code === 'NOT_PENDING' || code === 'BAD_STATUS') status = 409;
  else if (code === 'COOLDOWN' || code === 'TOO_MANY_ACTIVE') status = 429;

  if (status >= 500) logger.error('API error', { path: req.path, error: err.message, code });
  else logger.warn('API ditolak', { path: req.path, error: err.message, code });
  res.status(status).json({ error: err.message, code });
});

getDb();
const recovered = recoverInterrupted();
if (recovered > 0) logger.warn('Request terputus dikembalikan ke antrean', { count: recovered });
refreshQueueState();

const settings = getSettings();
startSpeechQueue();
if (settings.worker.enabled !== false) startWorker();

const server = app.listen(PORT, HOST, () => {
  logger.info(`Dashboard siap di http://${HOST}:${PORT}`);
  logger.info(`Overlay OBS: http://${HOST}:${PORT}/overlays/current-review.html`);
  logger.info('Tekan Start Live Monitor di dashboard untuk mulai membaca TikTok LIVE', {
    mode: settings.tiktok.mode,
    voice: settings.tts.voice,
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Berhenti…', { signal });
  stopWorker();
  stopSpeechQueue();
  await stopTikTok().catch(() => {});
  server.close(() => {
    closeDb();
    logger.info('Selesai');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: String(err?.message ?? err) }));
