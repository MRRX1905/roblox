// Sesi TikTok LIVE yang tahan banting.
//
// Kenapa file ini ada: `LiveConnection.layer()` mengambil cookie `ttwid` dari
// https://www.tiktok.com/ setiap kali layer dibuat. Pada pengujian live
// (November 2026) TikTok hanya mengirim cookie itu kira-kira 1 dari 4 request,
// sisanya HTTP 200 tanpa Set-Cookie. Akibatnya koneksi gagal acak dengan
// "TikTok did not issue a ttwid cookie", dan karena listener lama membuat layer
// baru di setiap percobaan, kegagalan itu berulang tanpa henti.
//
// Perbaikan:
//   1. Ambil ttwid dengan beberapa percobaan berjeda sebelum menyerah.
//   2. Simpan ttwid yang berhasil di memori (dipakai ulang saat reconnect) dan
//      di tabel `settings` (dipakai ulang setelah server restart).
//   3. Kalau TikTok menolak memberi cookie baru, pakai cookie terakhir yang
//      masih tersimpan daripada menggagalkan koneksi.

import { Effect, Layer } from 'effect';
import { LiveConnection, TikTokWeb } from 'tiklive/core';
import { readSettingsRows, writeSetting } from '../../database/repositories/system.repo.js';
import { logger } from '../../lib/logger.js';

const CACHE_KEY = 'tiktok.ttwid';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_ATTEMPTS = 8;

function readStored() {
  try {
    const stored = readSettingsRows()[CACHE_KEY];
    if (!stored?.value) return null;
    if (Date.now() - (stored.savedAt ?? 0) > MAX_AGE_MS) return null;
    return stored.value;
  } catch {
    return null;
  }
}

function store(ttwid) {
  try {
    writeSetting(CACHE_KEY, { value: ttwid, savedAt: Date.now() });
  } catch (err) {
    logger.warn('Gagal menyimpan ttwid ke database', { error: err.message });
  }
}

function unwrap(result) {
  if (!result) return { ok: false, error: null };
  if (result._tag === 'Success' || result._tag === 'Right') {
    return { ok: true, value: result.success ?? result.right };
  }
  return { ok: false, error: result.failure ?? result.left ?? null };
}

/**
 * Layer TikTokWeb + WebSocket yang memakai ttwid tahan banting.
 * Buat satu layer per listener lalu pakai ulang untuk semua reconnect.
 */
export function tiktokLayer({ userAgent } = {}) {
  let cached = null; // ttwid yang sudah terbukti dipakai di sesi ini

  const webLayer = Layer.effect(
    TikTokWeb.TikTokWeb,
    Effect.gen(function* () {
      const base = yield* TikTokWeb.TikTokWeb;

      const getTtwid = (options = {}) =>
        Effect.gen(function* () {
          if (!options.refresh) {
            if (cached) return cached;
            // Cookie dari sesi sebelumnya hampir selalu masih valid. Pakai
            // langsung supaya start/reconnect tidak menunggu percobaan ulang;
            // kalau socket ternyata ditolak, tiklive minta refresh sendiri.
            const stored = readStored();
            if (stored) {
              cached = stored;
              return stored;
            }
          }

          let lastError = null;
          for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
            const result = unwrap(yield* Effect.result(base.getTtwid({ refresh: true })));
            if (result.ok && result.value) {
              cached = result.value;
              store(cached);
              if (attempt > 1) {
                logger.info('ttwid TikTok didapat setelah percobaan ulang', { attempt });
              }
              return cached;
            }
            lastError = result.error;
            if (attempt < FETCH_ATTEMPTS) {
              yield* Effect.sleep(`${300 + attempt * 250} millis`);
            }
          }

          const stored = cached ?? readStored();
          if (stored) {
            logger.warn('TikTok tidak memberi ttwid baru, memakai cookie terakhir', {
              error: lastError?.message ?? String(lastError),
            });
            cached = stored;
            return stored;
          }

          logger.error('Gagal mendapatkan ttwid TikTok setelah semua percobaan', {
            attempts: FETCH_ATTEMPTS,
            error: lastError?.message ?? String(lastError),
          });
          return yield* Effect.fail(lastError);
        });

      return TikTokWeb.TikTokWeb.of({
        userAgent: base.userAgent ?? userAgent ?? TikTokWeb.DEFAULT_USER_AGENT,
        getTtwid,
        getRoomStatus: base.getRoomStatus,
        getGifts: base.getGifts,
      });
    }),
  ).pipe(Layer.provide(TikTokWeb.layer(userAgent ? { userAgent } : {})));

  return Layer.mergeAll(webLayer, LiveConnection.layerWebSocketGlobal);
}
