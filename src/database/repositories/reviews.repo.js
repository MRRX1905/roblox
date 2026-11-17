// Repository: hasil review, item yang dinilai, dan job suara.

import { all, get, nowIso, run } from '../db.js';

export function createReview({ requestId, robloxUserId, score, breakdown, dataset, narrationText, narrationSpeech, narrationSource }) {
  run(
    `INSERT INTO reviews (request_id, roblox_user_id, score, score_breakdown, dataset, narration_text, narration_speech, narration_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET
       roblox_user_id = excluded.roblox_user_id,
       score = excluded.score,
       score_breakdown = excluded.score_breakdown,
       dataset = excluded.dataset,
       narration_text = excluded.narration_text,
       narration_speech = excluded.narration_speech,
       narration_source = excluded.narration_source`,
    Number(requestId),
    robloxUserId ?? null,
    score ?? null,
    JSON.stringify(breakdown ?? null),
    JSON.stringify(dataset ?? null),
    narrationText ?? null,
    narrationSpeech ?? null,
    narrationSource ?? null,
    nowIso(),
  );
  return getReviewByRequest(requestId);
}

export function getReviewByRequest(requestId) {
  return get('SELECT * FROM reviews WHERE request_id = ?', Number(requestId));
}

export function getReview(id) {
  return get('SELECT * FROM reviews WHERE id = ?', Number(id));
}

export function replaceReviewItems(reviewId, items) {
  run('DELETE FROM review_items WHERE review_id = ?', Number(reviewId));
  for (const item of items) {
    run(
      `INSERT INTO review_items (review_id, asset_id, name, kind, category, price, resale_price, is_limited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      Number(reviewId),
      item.assetId == null ? null : String(item.assetId),
      item.name ?? null,
      item.kind ?? null,
      item.category ?? null,
      item.price == null ? null : Math.round(item.price),
      item.resalePrice == null ? null : Math.round(item.resalePrice),
      item.isLimited ? 1 : 0,
    );
  }
  return listReviewItems(reviewId);
}

export function listReviewItems(reviewId) {
  return all('SELECT * FROM review_items WHERE review_id = ? ORDER BY COALESCE(price,0) DESC, id ASC', Number(reviewId));
}

// -------------------------------------------------------------- speech jobs

export function createSpeechJob({ requestId, reviewId, voice, audioPath, durationMs = null, status = 'queued' }) {
  const result = run(
    `INSERT INTO speech_jobs (request_id, review_id, voice, audio_path, status, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    Number(requestId),
    reviewId ?? null,
    voice ?? null,
    audioPath ?? null,
    status,
    durationMs,
    nowIso(),
  );
  return getSpeechJob(Number(result.lastInsertRowid));
}

export function getSpeechJob(id) {
  return get('SELECT * FROM speech_jobs WHERE id = ?', Number(id));
}

export function getLatestSpeechJobForRequest(requestId) {
  return get('SELECT * FROM speech_jobs WHERE request_id = ? ORDER BY id DESC LIMIT 1', Number(requestId));
}

export function updateSpeechJob(id, patch) {
  const allowed = ['status', 'error', 'audio_path', 'duration_ms', 'played_at', 'voice'];
  const fields = Object.keys(patch).filter((k) => allowed.includes(k));
  if (fields.length === 0) return getSpeechJob(id);
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  run(`UPDATE speech_jobs SET ${sets} WHERE id = ?`, ...fields.map((f) => patch[f]), Number(id));
  return getSpeechJob(id);
}

/** Job berikutnya yang siap diputar, urut sesuai prioritas request-nya. */
export function nextSpeakableJob() {
  return get(
    `SELECT s.*, r.priority, r.package AS request_package, r.roblox_username
     FROM speech_jobs s
     JOIN requests r ON r.id = s.request_id
     WHERE s.status = 'queued' AND s.audio_path IS NOT NULL
       AND r.status IN ('waiting','generating_audio','playing')
     ORDER BY r.priority DESC, s.id ASC
     LIMIT 1`,
  );
}

export function listSpeechQueue(limit = 20) {
  return all(
    `SELECT s.*, r.roblox_username, r.tiktok_user, r.priority
     FROM speech_jobs s JOIN requests r ON r.id = s.request_id
     WHERE s.status IN ('queued','playing')
     ORDER BY r.priority DESC, s.id ASC
     LIMIT ?`,
    limit,
  );
}

export function pendingSpeechCount() {
  return get("SELECT COUNT(*) AS n FROM speech_jobs WHERE status = 'queued'")?.n ?? 0;
}
