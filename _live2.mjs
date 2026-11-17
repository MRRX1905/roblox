import { Effect, Fiber, Stream } from 'effect';
import { LiveConnection } from 'tiklive/core';
import { tiktokLayer } from './src/integrations/tiktok/session.js';

const username = process.argv[2] ?? 'evosvann077';
const layer = tiktokLayer();
const counts = {};

async function runOnce(seconds) {
  const program = Stream.runForEach(LiveConnection.events(username), (e) =>
    Effect.sync(() => {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === 'chat') console.log('  chat @' + e.user?.uniqueId + ': ' + String(e.comment).slice(0, 70));
    }),
  );
  const fiber = Effect.runFork(Effect.provide(program, layer));
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {});
}

const t0 = Date.now();
await runOnce(12);
console.log('koneksi 1 selesai dalam', Math.round((Date.now() - t0) / 1000), 'detik, event:', counts);
await runOnce(8);
console.log('koneksi 2 event kumulatif:', counts);
process.exit(0);
