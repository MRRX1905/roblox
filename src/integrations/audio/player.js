// Pemutar audio lewat ffplay, supaya bisa menunjuk device output tertentu
// (mis. "CABLE Input (VB-Audio Virtual Cable)") tanpa mengubah device default Windows.
//
// Kalau device yang diminta tidak ada, pemutaran diulang sekali ke device default
// dan hasilnya dilaporkan sebagai warning — bukan gagal diam-diam.

import { spawn } from 'node:child_process';
import { logger } from '../../lib/logger.js';

function attempt({ filePath, device, volume }) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-nodisp', '-autoexit', '-volume', String(Math.round(volume ?? 1) * 100)];
    if (device) args.push('-audio-device', device);
    args.push(filePath);

    const proc = spawn('ffplay', args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(Object.assign(new Error(`ffplay tidak bisa dijalankan: ${err.message}`), { code: err.code }));
    });
    proc.on('close', (code, signal) => {
      resolve({ code, signal, stderr, proc });
    });
  });
}

/**
 * @returns {Promise<{ok:boolean, stopped:boolean, usedFallbackDevice:boolean, error?:string}>}
 */
export async function playAudio({ filePath, device, volume = 1 }) {
  const first = await attempt({ filePath, device, volume });
  if (first.code === 0 || first.signal) return { ok: true, stopped: !!first.signal, usedFallbackDevice: false };

  const errorText = first.stderr.trim() || `ffplay keluar dengan kode ${first.code}`;
  if (device) {
    logger.warn('Device audio gagal dipakai, mencoba device default', { device, error: errorText.slice(0, 200) });
    const retry = await attempt({ filePath, device: '', volume });
    if (retry.code === 0 || retry.signal) {
      return { ok: true, stopped: !!retry.signal, usedFallbackDevice: true, error: errorText.slice(0, 200) };
    }
    return { ok: false, stopped: false, usedFallbackDevice: true, error: (retry.stderr || errorText).slice(0, 300) };
  }
  return { ok: false, stopped: false, usedFallbackDevice: false, error: errorText.slice(0, 300) };
}

/** Versi yang bisa dihentikan (skip / emergency stop). */
export function startPlayback({ filePath, device, volume = 1, onExit }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nodisp', '-autoexit', '-volume', String(Math.round(volume ?? 1) * 100)];
  if (device) args.push('-audio-device', device);
  args.push(filePath);

  const proc = spawn('ffplay', args, { windowsHide: true });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const finished = new Promise((resolve) => {
    proc.on('error', (err) => resolve({ code: -1, signal: null, stderr: `spawn gagal: ${err.message}` }));
    proc.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });

  finished.then((result) => onExit?.(result));
  return {
    proc,
    finished,
    kill() {
      try {
        proc.kill();
      } catch {
        // sudah berhenti
      }
    },
    get stderr() {
      return stderr;
    },
  };
}
