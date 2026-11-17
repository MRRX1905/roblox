// edge-tts (Microsoft Read Aloud) lewat msedge-tts — murni Node, tanpa Python.
// Voice Indonesia yang tersedia: id-ID-ArdiNeural (pria), id-ID-GadisNeural (wanita).

import { writeFileSync } from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const EDGE_VOICES = {
  male: 'id-ID-ArdiNeural',
  female: 'id-ID-GadisNeural',
};

/**
 * @param {{text:string, voice:string, rate?:string, pitch?:string, outPath:string}} options
 */
export async function synthesizeEdge({ text, voice, rate = '+0%', pitch = '+0Hz', outPath }) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: 60_000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(text, { rate, pitch });
    const chunks = [];
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('end', () => done());
      audioStream.on('close', () => done());
      audioStream.on('error', (err) => done(err));
    });
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 1000) throw new Error('Audio yang diterima terlalu kecil / kosong');
    writeFileSync(outPath, buffer);
    return { path: outPath, bytes: buffer.length };
  } finally {
    try {
      tts.close();
    } catch {
      // koneksi mungkin sudah tertutup
    }
  }
}
