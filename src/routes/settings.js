// API settings. Perubahan tts/audio/tiktok berlaku pada review berikutnya.

import { Router } from 'express';
import { getPublicSettings, resetSettings, updateSettings } from '../services/settings.service.js';
import { EDGE_VOICES } from '../integrations/tts/edge.js';
import { GIFT_MAPPING } from '../config/gifts.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json({
    settings: getPublicSettings(),
    voices: Object.values(EDGE_VOICES),
    giftMapping: GIFT_MAPPING,
  });
});

settingsRouter.patch('/', (req, res, next) => {
  try {
    const settings = updateSettings(req.body ?? {});
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/reset', (req, res) => {
  res.json({ settings: resetSettings() });
});
