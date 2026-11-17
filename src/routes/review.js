// API hasil review: dataset, statistik, naskah, item, dan audio.

import { Router } from 'express';
import { getRequest, listRecent } from '../database/repositories/requests.repo.js';
import { getLatestSpeechJobForRequest, getReviewByRequest, listReviewItems } from '../database/repositories/reviews.repo.js';

export const reviewRouter = Router();

reviewRouter.get('/recent', (req, res) => {
  res.json({ requests: listRecent(Number(req.query.limit ?? 30)) });
});

reviewRouter.get('/:requestId', (req, res) => {
  const requestId = Number(req.params.requestId);
  const request = getRequest(requestId);
  if (!request) return res.status(404).json({ error: 'Request tidak ditemukan' });
  const review = getReviewByRequest(requestId);
  const items = review ? listReviewItems(review.id) : [];
  const speech = getLatestSpeechJobForRequest(requestId);
  let dataset = null;
  let breakdown = null;
  try {
    dataset = review?.dataset ? JSON.parse(review.dataset) : null;
    breakdown = review?.score_breakdown ? JSON.parse(review.score_breakdown) : null;
  } catch {
    // dataset rusak tidak boleh menjatuhkan endpoint
  }
  res.json({
    request,
    review: review
      ? {
          id: review.id,
          score: review.score,
          breakdown,
          narrationText: review.narration_text,
          narrationSpeech: review.narration_speech,
          source: review.narration_source,
          createdAt: review.created_at,
        }
      : null,
    items,
    speech,
    dataset,
  });
});
