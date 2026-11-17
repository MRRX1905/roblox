// Cadangan kalau Read Aloud menolak (Microsoft pernah mematahkannya Okt 2026).
// Butuh `pip install edge-tts` dan Python di PATH. Hanya dipakai kalau
// settings.tts.pythonFallback = true.

import { spawn } from 'node:child_process';

export async function synthesizeWithPython({ text, voice, outPath, pythonBin = 'python' }) {
  await new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', outPath], {
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(new Error(`Python edge-tts tidak bisa dijalankan: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts keluar dengan kode ${code}: ${stderr.slice(0, 300)}`));
    });
  });
  return { path: outPath };
}
