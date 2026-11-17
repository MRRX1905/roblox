// API kontrol suara: status, skip, pause/resume, mute, emergency stop.

import { Router } from 'express';
import {
  emergencyStop,
  getSpeechState,
  pause,
  resume,
  setMuted,
  skipCurrent,
} from '../services/speech-queue.service.js';
import { listSpeechQueue, pendingSpeechCount } from '../database/repositories/reviews.repo.js';
import { refreshQueueState } from '../services/queue.service.js';

export const audioRouter = Router();

audioRouter.get('/state', (req, res) => {
  res.json({
    ...getSpeechState(),
    pending: pendingSpeechCount(),
    queue: listSpeechQueue(20),
  });
});

audioRouter.post('/skip', (req, res) => {
  const skipped = skipCurrent();
  res.json({ skipped, state: getSpeechState() });
});

audioRouter.post('/pause', (req, res) => {
  pause();
  res.json({ state: getSpeechState() });
});

audioRouter.post('/resume', (req, res) => {
  resume();
  res.json({ state: getSpeechState() });
});

audioRouter.post('/mute', (req, res) => {
  setMuted(req.body?.muted !== false);
  res.json({ state: getSpeechState() });
});

audioRouter.post('/stop', (req, res) => {
  const result = emergencyStop();
  refreshQueueState();
  res.json({ ...result, state: getSpeechState() });
});
