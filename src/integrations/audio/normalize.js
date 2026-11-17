// Normalisasi audio: loudness seragam + 48 kHz stereo (format yang nyaman untuk
// VB-Cable dan OBS). Tanpa ini volume antar review bisa berbeda jauh.

import { spawn } from 'node:child_process';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(new Error(`ffmpeg tidak bisa dijalankan: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg keluar dengan kode ${code}: ${stderr.slice(-400)}`));
    });
  });
}

export async function normalizeAudio({ input, output }) {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    output,
  ]);
  return { path: output };
}

export async function probeDurationMs(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
      { windowsHide: true },
    );
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const seconds = Number(out.trim());
      resolve(Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);
    });
  });
}
