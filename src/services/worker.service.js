// Worker pipeline: satu request diproses sampai audio siap, lalu diserahkan
// ke speech queue. Single concurrency supaya satu akun tidak membanjiri CPU
// sekaligus (Ollama/ffmpeg di laptop bisa saling berebut).

import { fetchAccount } from './roblox.service.js';
import { analyzeAccount } from './analysis.service.js';
import { buildNarration } from './narration.service.js';
import { synthesizeReviewText } from './tts.service.js';
import { getSettings } from './settings.service.js';
import { nextRequest } from './queue.service.js';
import { updateRequest } from '../database/repositories/requests.repo.js';
import { createReview, createSpeechJob, replaceReviewItems } from '../database/repositories/reviews.repo.js';
import { nowIso } from '../database/db.js';
import { pruneSeenEvents } from '../database/repositories/system.repo.js';
import * as events from './events.service.js';
import { logger } from '../lib/logger.js';

const TICK_MS = 500;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const SEEN_EVENTS_TTL_MS = 24 * 60 * 60 * 1000;

let timer = null;
let pruneTimer = null;
let running = false;
let currentRequestId = null;

function stage(status, extra = {}) {
  events.updateTask({ status, requestId: currentRequestId, ...extra });
}

function publishReview(dataset, analysis, narration, requestId) {
  events.updateState({
    review: {
      requestId,
      username: dataset.username,
      displayName: dataset.displayName,
      avatarUrl: dataset.avatar.images.full,
      headshotUrl: dataset.avatar.images.headshot,
      score: analysis.display.score,
      verdict: analysis.display.verdict,
      stats: {
        outfitItems: analysis.stats.outfitItems,
        outfitValue: analysis.display.outfitValue,
        limitedCount: analysis.stats.limitedCount,
        limitedRap: analysis.display.limitedRap,
        followers: analysis.display.followers,
        friends: analysis.display.friends,
        mostExpensive: analysis.display.mostExpensive,
      },
      partial: dataset.dataQuality.partial,
      notes: dataset.dataQuality.notes,
      narrationText: narration?.text ?? null,
      narrationSource: narration?.source ?? null,
      at: nowIso(),
    },
  });
}

async function processRequest(request) {
  const settings = getSettings();
  updateRequest(request.id, { status: 'processing', started_at: nowIso(), error: null });
  stage('processing', { username: request.roblox_username });
  logger.info('Worker mulai memproses', { requestId: request.id, username: request.roblox_username });

  const dataset = await fetchAccount(request.roblox_username);
  updateRequest(request.id, { roblox_user_id: dataset.userId });
  stage('analyzing', { username: dataset.username });

  const analysis = analyzeAccount(dataset);
  const narration = await buildNarration(dataset, analysis, { settings, packageId: request.package });

  const review = createReview({
    requestId: request.id,
    robloxUserId: dataset.userId,
    score: analysis.score,
    breakdown: analysis.breakdown,
    dataset,
    narrationText: narration.text,
    narrationSpeech: narration.speech,
    narrationSource: narration.source,
  });
  replaceReviewItems(review.id, [
    ...dataset.outfit.items,
    ...dataset.collectibles.items.map((item) => ({
      assetId: item.assetId,
      name: item.name,
      kind: 'collectible',
      category: null,
      price: item.originalPrice,
      resalePrice: item.recentAveragePrice,
      isLimited: true,
    })),
  ]);
  publishReview(dataset, analysis, narration, request.id);

  stage('generating_audio', { username: dataset.username });
  const voice = request.package === 'vip_express' ? settings.tts.altVoice : settings.tts.voice;
  const audio = await synthesizeReviewText({ text: narration.speech, voice, settings });

  createSpeechJob({
    requestId: request.id,
    reviewId: review.id,
    voice,
    audioPath: audio.path,
    durationMs: audio.durationMs,
  });

  // Audio siap. Status 'generating_audio' berarti "menunggu giliran diputar"
  // dan tidak akan diambil ulang oleh nextRequest() (hanya 'waiting' yang diambil).
  updateRequest(request.id, { status: 'generating_audio' });
  logger.info('Audio siap diputar', {
    requestId: request.id,
    durationMs: audio.durationMs,
    cached: audio.cached,
    words: narration.meta?.words,
    source: narration.source,
  });
  return { dataset, analysis, narration, audio };
}

async function tick() {
  if (running) return;
  let request;
  try {
    request = nextRequest();
  } catch (err) {
    logger.error('Gagal membaca antrean', { error: err.message });
    return;
  }
  if (!request) return;

  running = true;
  currentRequestId = request.id;
  try {
    await processRequest(request);
    stage('queued-for-audio', { requestId: request.id });
  } catch (err) {
    const message =
      err.code === 'USER_NOT_FOUND' || err.code === 'INVALID_USERNAME'
        ? err.message
        : `${err.name}: ${err.message}`;
    updateRequest(request.id, {
      status: 'failed',
      error: message.slice(0, 500),
      completed_at: nowIso(),
    });
    logger.error('Worker gagal memproses request', { requestId: request.id, error: message });
    stage('failed', { requestId: request.id, error: message });
    events.setAlert({ kind: 'error', message: `Request #${request.id} gagal: ${message}` });
  } finally {
    running = false;
    currentRequestId = null;
    events.updateState({ queue: events.getOverlayState().queue });
  }
}

export function startWorker() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => logger.error('Worker error', { error: err.message }));
  }, TICK_MS);
  // Live ramai menulis ribuan msgId per jam; dedupe lama dibuang berkala.
  pruneTimer = setInterval(() => {
    try {
      pruneSeenEvents(new Date(Date.now() - SEEN_EVENTS_TTL_MS).toISOString());
    } catch (err) {
      logger.warn('Gagal membersihkan dedupe event', { error: err.message });
    }
  }, PRUNE_INTERVAL_MS);
  logger.info('Worker antrean berjalan');
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  if (pruneTimer) clearInterval(pruneTimer);
  timer = null;
  pruneTimer = null;
}

export function getWorkerState() {
  return { running, currentRequestId };
}
