// Endpoint ringan untuk Browser Source OBS. Hanya data yang perlu ditampilkan.

import { Router } from 'express';
import { getOverlayState } from '../services/events.service.js';

export const overlayRouter = Router();

overlayRouter.get('/state', (req, res) => {
  res.set('cache-control', 'no-store');
  const state = getOverlayState();
  res.json({
    review: state.review ?? null,
    queue: state.queue ?? [],
    alert: state.alert ?? null,
    task: state.task ?? null,
    speech: state.speech ?? null,
    tiktok: state.tiktok ?? null,
  });
});

overlayRouter.get('/queue', (req, res) => {
  res.set('cache-control', 'no-store');
  res.json({ queue: getOverlayState().queue ?? [] });
});
