import { Effect, Fiber, Stream } from 'effect';
import { LiveConnection } from 'tiklive/core';

const username = process.argv[2] ?? 'evosvann077';
const seconds = Number(process.argv[3] ?? 25);

const program = Stream.runForEach(
  LiveConnection.connect(username, { includeRaw: true, connectTimeout: '15 seconds' }),
  (e) => Effect.sync(() => {
    const t = new Date().toISOString().slice(11, 19);
    if (e._tag === 'Raw') { console.log(t, 'raw', e.message.method); return; }
    if (e._tag === 'Event') { console.log(t, 'EVENT', e.event.type, JSON.stringify(e.event).slice(0, 160)); return; }
    console.log(t, e._tag, JSON.stringify(e).slice(0, 200));
  }),
);
const fiber = Effect.runFork(Effect.provide(program, LiveConnection.layer()));
await new Promise((r) => setTimeout(r, seconds * 1000));
await Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {});
console.log('--- selesai ---');
process.exit(0);
