// API kontrol listener TikTok LIVE (mode demo / live).

import { Router } from 'express';
import { getTikTokStatus, simulateChat, startTikTok, stopTikTok } from '../services/tiktok.service.js';

export const tiktokRouter = Router();

tiktokRouter.get('/status', (req, res) => {
  res.json(getTikTokStatus());
});

tiktokRouter.post('/start', async (req, res, next) => {
  try {
    const { mode, username } = req.body ?? {};
    if (mode && !['demo', 'live'].includes(mode)) {
      return res.status(400).json({ error: "mode harus 'demo' atau 'live'" });
    }
    const status = await startTikTok({ mode, username });
    return res.json({ status, message: mode === 'demo' ? 'Mode demo aktif' : 'Mencoba terhubung ke live' });
  } catch (err) {
    return next(err);
  }
});

// Alat uji: kirim komentar buatan ke pipeline komentar yang sama dengan live.
// Aplikasi ini hanya membaca chat, jadi tanpa ini alur perintah tidak bisa
// diuji saat live sungguhan.
tiktokRouter.post('/simulate', (req, res, next) => {
  try {
    const { comment, tiktokUser, nickname } = req.body ?? {};
    if (typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ error: 'comment wajib diisi' });
    }
    const result = simulateChat({ comment: comment.trim(), tiktokUser, nickname });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'LISTENER_OFFLINE') return res.status(409).json({ error: err.message, code: err.code });
    return next(err);
  }
});

tiktokRouter.post('/stop', async (req, res, next) => {
  try {
    await stopTikTok();
    res.json({ status: getTikTokStatus() });
  } catch (err) {
    next(err);
  }
});
