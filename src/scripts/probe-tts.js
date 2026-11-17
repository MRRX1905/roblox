// Probe TTS: memastikan dua suara Indonesia benar-benar menghasilkan audio.
// Pakai: npm run probe:tts

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const voices = ['id-ID-ArdiNeural', 'id-ID-GadisNeural'];
const text = 'Halo, ini tes suara untuk review akun Roblox. Nilai outfit-nya dua ribu empat ratus lima puluh Robux.';
const outDir = resolve(process.env.DATA_DIR || 'storage', 'audio');
mkdirSync(outDir, { recursive: true });

for (const voice of voices) {
  const target = join(outDir, `probe-${voice}.mp3`);
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: 45_000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(text);
    const chunks = [];
    await new Promise((res, rej) => {
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', res);
      audioStream.on('close', res);
      audioStream.on('error', rej);
    });
    const buffer = Buffer.concat(chunks);
    writeFileSync(target, buffer);
    const size = statSync(target).size;
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', target], {
      encoding: 'utf8',
    });
    console.log(`OK   ${voice} -> ${target} (${size} bytes, durasi ${(probe.stdout || '?').trim()}s)`);
  } catch (err) {
    console.error(`GAGAL ${voice}: ${err.name}: ${err.message}`);
    console.error('       Kalau 403/handshake: Microsoft mematahkan Read Aloud API. Pakai python fallback (lihat README).');
    process.exitCode = 1;
  } finally {
    try {
      tts.close();
    } catch {
      // abaikan
    }
  }
}
