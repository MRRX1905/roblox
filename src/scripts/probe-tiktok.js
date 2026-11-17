// Probe jalur LIVE TikTok (bukan demo).
//
// Pakai:
//   node src/scripts/probe-tiktok.js <username> [username...]
//   node src/scripts/probe-tiktok.js <username> --watch [detik]
//
// Tanpa --watch: cek apakah room sedang live dengan membuka koneksi dan
// membaca event pertama (`Connected`). TikTokWeb tidak dipakai karena di
// tiklive 0.6.0 ia hanya tersedia lewat layer, bukan sebagai fungsi langsung.
// Dengan --watch: kalau room live, sambung sebentar dan cetak event mentah
// yang diterima (chat/gift/like/follow).

import { Effect, Fiber, Stream } from 'effect';
import { LiveConnection } from 'tiklive/core';
import { normalizeUsername } from 'tiklive/contracts';

const args = process.argv.slice(2);
const watchIndex = args.indexOf('--watch');
const watch = watchIndex !== -1;
const secondsArg = watch ? Number(args[watchIndex + 1]) : NaN;
const watchSeconds = Number.isFinite(secondsArg) && secondsArg > 0 ? secondsArg : 15;
const usernames = args.filter((arg, i) => arg !== '--watch' && !(watch && i === watchIndex + 1));

function describeError(err) {
  if (!err) return String(err);
  const tag = err._tag ?? err.name ?? '';
  const details = (() => {
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 500);
    } catch {
      return String(err);
    }
  })();
  return `${tag} ${details}`;
}

async function roomStatus(username) {
  let first;
  const program = Stream.runForEach(
    Stream.take(LiveConnection.connect(username, { connectTimeout: '10 seconds' }), 1),
    (event) => Effect.sync(() => {
      first = event;
    }),
  );
  const effect = Effect.provide(program, LiveConnection.layer());
  await Promise.race([
    Effect.runPromise(effect),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout koneksi 25 detik')), 25_000)),
  ]).catch((err) => {
    if (first === undefined) throw err;
  });
  return { first };
}

async function watchEvents(username) {
  let received = 0;
  const program = Stream.runForEach(LiveConnection.events(username), (event) =>
    Effect.sync(() => {
      received += 1;
      const who = event.user?.uniqueId ?? '-';
      if (event.type === 'chat') console.log(`  chat  @${who}: ${event.comment}`);
      else if (event.type === 'gift') console.log(`  gift  @${who}: ${event.giftName} x${event.repeatCount} (streaking=${event.streaking})`);
      else if (event.type === 'like') console.log(`  like  @${who}: +${event.likeCount}`);
      else console.log(`  ${event.type} @${who}`);
    }),
  );
  const effect = Effect.provide(program, LiveConnection.layer());
  const fiber = Effect.runFork(effect);
  await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));
  await Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {});
  return received;
}

let liveFound = null;
for (const raw of usernames) {
  const username = normalizeUsername(raw);
  process.stdout.write(`\n=== @${username} ===\n`);
  try {
    const { first } = await roomStatus(username);
    console.log(`event pertama: ${first?._tag ?? first?.type ?? 'unknown'}`);
    console.log(JSON.stringify(first).slice(0, 400));
    if (first?._tag === 'Connected') {
      liveFound = liveFound ?? username;
    }
  } catch (err) {
    console.log(`GAGAL: ${describeError(err)}`);
  }
}

if (watch && liveFound) {
  console.log(`\n>>> Menyambung ke @${liveFound} selama maksimal ${watchSeconds} detik…`);
  const received = await watchEvents(liveFound);
  console.log(`>>> Selesai. ${received} event diterima dalam ${watchSeconds} detik.`);
} else if (watch) {
  console.log('\n>>> Tidak ada room live untuk di-watch.');
}
