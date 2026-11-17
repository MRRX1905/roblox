// Antrean suara: AI/worker boleh menyiapkan banyak review, tapi audio diputar
// SATU PER SATU. Tidak ada dua suara yang saling menimpa.

import {
  listSpeechQueue,
  nextSpeakableJob,
  pendingSpeechCount,
  updateSpeechJob,
} from '../database/repositories/reviews.repo.js';
import { getRequest, listWaiting, updateRequest } from '../database/repositories/requests.repo.js';
import { startPlayback } from '../integrations/audio/player.js';
import { getSettings } from './settings.service.js';
import * as events from './events.service.js';
import { nowIso } from '../database/db.js';
import { logger } from '../lib/logger.js';

const TICK_MS = 400;

let timer = null;
let busy = false;
let paused = false;
let muted = false;
let current = null;
let lastError = null;

function publishState() {
  const speech = {
    playing: !!current,
    paused,
    muted,
    current: current
      ? {
          jobId: current.job.id,
          requestId: current.job.request_id,
          username: current.job.roblox_username,
          startedAt: current.startedAt,
        }
      : null,
    pending: pendingSpeechCount(),
    lastError,
  };
  events.updateState({ speech });
}

async function playJob(job, settings) {
  const audio = settings?.audio ?? {};
  const volume = Number.isFinite(audio.volume) ? audio.volume : 1;
  const device = audio.device || '';

  const run = async (targetDevice) => {
    const handle = startPlayback({ filePath: job.audio_path, device: targetDevice, volume });
    current.proc = handle;
    return handle.finished;
  };

  let result = await run(device);
  if (result.code !== 0 && !result.signal && device) {
    logger.warn('Device audio gagal, mengulang di device default', { device, error: (result.stderr || '').slice(0, 200) });
    current.usedFallbackDevice = true;
    result = await run('');
  }
  return result;
}

async function finalize(status, note) {
  if (!current) return;
  const { job, skipped } = current;
  const request = getRequest(job.request_id);

  if (status === 'played' || status === 'skipped') {
    updateSpeechJob(job.id, { status: status === 'played' ? 'played' : 'skipped', played_at: nowIso(), error: note ?? null });
    if (request && !['completed', 'cancelled'].includes(request.status)) {
      updateRequest(job.request_id, { status: 'completed', completed_at: nowIso(), note: note ?? request.note });
    }
  } else {
    updateSpeechJob(job.id, { status: 'failed', error: note ?? 'gagal diputar' });
    if (request) {
      updateRequest(job.request_id, { status: 'failed', error: note ?? 'gagal diputar', completed_at: nowIso() });
    }
  }

  events.emit('speech', {
    state: status,
    requestId: job.request_id,
    username: job.roblox_username,
    skipped: !!skipped,
    note: note ?? null,
  });
  current = null;
  publishState();
}

async function tick() {
  if (busy || paused) return;
  const job = nextSpeakableJob();
  if (!job) {
    publishState();
    return;
  }

  busy = true;
  current = {
    job,
    proc: null,
    startedAt: nowIso(),
    skipped: false,
    usedFallbackDevice: false,
  };
  const settings = getSettings();
  lastError = null;

  updateSpeechJob(job.id, { status: 'playing' });
  updateRequest(job.request_id, { status: 'playing', started_at: nowIso() });
  events.updateTask({ status: 'playing', requestId: job.request_id, username: job.roblox_username });
  publishState();
  logger.info('Memutar review', { requestId: job.request_id, username: job.roblox_username });

  try {
    if (muted) {
      await finalize('played', 'Audio di-mute oleh admin');
    } else if (!job.audio_path) {
      await finalize('failed', 'File audio tidak ada');
    } else {
      const result = await playJob(job, settings);
      if (current?.skipped) {
        await finalize('skipped', 'Dilewati admin');
      } else if (result.signal) {
        await finalize('skipped', `Pemutaran dihentikan (${result.signal})`);
      } else if (result.code === 0) {
        if (current?.usedFallbackDevice) {
          logger.warn('Audio diputar di device default, bukan device yang dipilih di settings');
        }
        await finalize('played');
      } else {
        const error = (result.stderr || '').trim() || `ffplay keluar dengan kode ${result.code}`;
        lastError = error.slice(0, 300);
        await finalize('failed', lastError);
      }
    }
  } catch (err) {
    lastError = err.message;
    await finalize('failed', err.message);
    logger.error('Pemutaran gagal', { error: err.message });
  } finally {
    busy = false;
  }
}

export function startSpeechQueue() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => logger.error('Speech queue error', { error: err.message }));
  }, TICK_MS);
  logger.info('Speech queue berjalan');
}

export function stopSpeechQueue() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function skipCurrent() {
  if (!current) return false;
  current.skipped = true;
  current.proc?.kill();
  logger.info('Skip diminta admin', { requestId: current.job.request_id });
  return true;
}

export function pause() {
  paused = true;
  publishState();
}

export function resume() {
  paused = false;
  publishState();
}

export function setPaused(value) {
  if (value) pause();
  else resume();
}

export function setMuted(value) {
  muted = !!value;
  publishState();
}

/**
 * Emergency stop: hentikan suara sekarang, batalkan semua audio yang menunggu,
 * dan kembalikan review-nya ke antrean (bukan dihapus).
 */
export function emergencyStop() {
  const stoppedRequest = current?.job?.request_id ?? null;
  if (current) {
    current.skipped = true;
    current.proc?.kill();
  }

  const queued = listSpeechQueue(200).filter((job) => job.status === 'queued');
  for (const job of queued) {
    updateSpeechJob(job.id, { status: 'skipped', error: 'Emergency stop' });
    const request = getRequest(job.request_id);
    if (request && !['completed', 'cancelled'].includes(request.status)) {
      updateRequest(job.request_id, { status: 'waiting', note: 'Dikembalikan ke antrean oleh emergency stop' });
    }
  }
  logger.warn('Emergency stop dijalankan', { stoppedRequest, cancelledAudio: queued.length });
  events.emit('speech', { state: 'emergency-stop', requestId: stoppedRequest });
  events.setAlert({ kind: 'emergency-stop', message: 'Audio dihentikan admin' });
  return { stoppedRequest, cancelledAudio: queued.length, waiting: listWaiting().length };
}

export function getSpeechState() {
  return {
    playing: !!current,
    paused,
    muted,
    current: current ? { jobId: current.job.id, requestId: current.job.request_id, username: current.job.roblox_username } : null,
    lastError,
  };
}
