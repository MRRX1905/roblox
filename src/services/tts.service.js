// Teks -> file audio siap diputar.
// Cache berdasarkan hash teks+suara+engine, jadi review yang di-retry tidak
// memanggil Microsoft lagi (dan tetap ada walau internet mati).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../database/db.js';
import { synthesizeEdge } from '../integrations/tts/edge.js';
import { synthesizeWithPython } from '../integrations/tts/python-fallback.js';
import { normalizeAudio, probeDurationMs } from '../integrations/audio/normalize.js';
import { logger } from '../lib/logger.js';

function audioDir() {
  const dir = join(dataDir(), 'audio');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function audioPathFor({ text, voice, rate, engine }) {
  const hash = createHash('sha1').update(`${engine}|${voice}|${rate}|${text}`).digest('hex').slice(0, 24);
  return { hash, path: join(audioDir(), `${hash}.wav`) };
}

/**
 * @returns {Promise<{path:string, durationMs:number|null, cached:boolean, voice:string, engine:string}>}
 */
export async function synthesizeReviewText({ text, voice, settings }) {
  const tts = settings?.tts ?? {};
  const engine = tts.engine ?? 'edge';
  const rate = tts.rate ?? '+0%';
  const pitch = tts.pitch ?? '+0Hz';
  const target = audioPathFor({ text, voice, rate, engine });

  if (existsSync(target.path) && statSync(target.path).size > 1000) {
    return { path: target.path, durationMs: await probeDurationMs(target.path), cached: true, voice, engine };
  }

  if (engine === 'none') {
    const err = new Error('TTS dimatikan di settings');
    err.code = 'TTS_DISABLED';
    throw err;
  }

  const mp3Path = join(audioDir(), `${target.hash}.mp3`);
  const attempts = [];

  try {
    await synthesizeEdge({ text, voice, rate, pitch, outPath: mp3Path });
  } catch (edgeError) {
    attempts.push(`edge: ${edgeError.message}`);
    if (tts.pythonFallback) {
      try {
        await synthesizeWithPython({ text, voice, outPath: mp3Path });
      } catch (pyError) {
        attempts.push(`python: ${pyError.message}`);
      }
    }
    if (attempts.length === 1) {
      const err = new Error(`TTS gagal (${attempts.join('; ')})`);
      err.code = 'TTS_FAILED';
      throw err;
    }
  }

  if (!existsSync(mp3Path)) {
    const err = new Error(`TTS tidak menghasilkan file (${attempts.join('; ') || 'tanpa detail'})`);
    err.code = 'TTS_FAILED';
    throw err;
  }

  await normalizeAudio({ input: mp3Path, output: target.path });
  const durationMs = await probeDurationMs(target.path);
  try {
    unlinkSync(mp3Path);
  } catch {
    // biarkan file sementara kalau gagal dihapus
  }
  logger.info('TTS selesai', { voice, durationMs, bytes: statSync(target.path).size, attempts: attempts.length });
  return { path: target.path, durationMs, cached: false, voice, engine };
}
