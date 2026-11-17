// Pembungkus tiklive/core menjadi EventEmitter biasa.
//
// Semua kode Effect terkurung di file ini. Sisa aplikasi tidak perlu tahu
// tentang Stream/Fiber/Layer.
//
// Mode 'demo' memakai demoEvents dari tiklive: aliran event palsu untuk menguji
// seluruh sistem tanpa live dan tanpa risiko akun.
// Mode 'live' memakai LiveConnection.events(username).

import { EventEmitter } from 'node:events';
import { Effect, Stream, Fiber } from 'effect';
import { LiveConnection, demoEvents } from 'tiklive/core';
import { tiktokLayer } from './session.js';
import { logger } from '../../lib/logger.js';

function describeError(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  if (err._tag) return err._tag;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err).slice(0, 300);
  } catch {
    return String(err);
  }
}

function isInterrupt(err) {
  const text = describeError(err);
  return /interrupt/i.test(text) || /Interrupt/i.test(err?.constructor?.name ?? '');
}

export class TikTokListener extends EventEmitter {
  constructor({ mode = 'demo', username = 'demo' } = {}) {
    super();
    this.mode = mode === 'live' ? 'live' : 'demo';
    this.username = username || 'demo';
    this.generation = 0;
    this.running = false;
    this.fiber = null;
    this.layer = null;
    this.state = 'idle';
    this.stats = { events: 0, chats: 0, gifts: 0, likes: 0, follows: 0, viewers: null };
    this.room = null;
    this.lastError = null;
  }

  setStatus(state, extra = {}) {
    this.state = state;
    this.emit('status', { state, mode: this.mode, username: this.username, stats: this.stats, ...extra });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    // Satu layer per listener: cookie ttwid dipakai ulang untuk semua reconnect,
    // jadi satu kali gagal ambil cookie tidak menjatuhkan sesi berikutnya.
    this.layer = this.mode === 'live' ? tiktokLayer() : null;
    this.setStatus(this.mode === 'demo' ? 'demo' : 'connecting');
    this.loop(this.generation).catch((err) => {
      logger.error('Loop listener TikTok berhenti tak terduga', { error: describeError(err) });
    });
  }

  async loop(generation) {
    let delay = 2000;
    let offline = false;
    while (this.running && this.generation === generation) {
      const stream = this.mode === 'demo'
        ? demoEvents
        : LiveConnection.connect(this.username, { reconnect: { maxAttempts: 5 } });
      const program = Stream.runForEach(stream, (event) =>
        Effect.sync(() => {
          if (this.generation !== generation) return;
          this.handleConnectionEvent(event);
        }),
      );
      const effect = this.mode === 'demo' ? program : Effect.provide(program, this.layer);

      try {
        this.fiber = Effect.runFork(effect);
        await Effect.runPromise(Fiber.join(this.fiber));
        this.fiber = null;
        if (!this.running || this.generation !== generation) break;
        this.setStatus('offline', { message: 'Live berakhir atau streamer offline' });
        delay = 5000;
      } catch (err) {
        this.fiber = null;
        if (!this.running || this.generation !== generation || isInterrupt(err)) break;
        this.lastError = describeError(err);
        offline = /UserOffline|not live|offline/i.test(this.lastError);
        const cookie = /ttwid|cookie/i.test(this.lastError);
        const message = cookie
          ? 'TikTok tidak memberi cookie sesi (ttwid). Mencoba lagi sebentar lagi.'
          : this.lastError;
        this.setStatus(offline ? 'offline' : 'error', { message });
        logger.warn('Listener TikTok gagal, mencoba lagi', { error: this.lastError, retryInMs: delay });
      }

      if (!this.running || this.generation !== generation) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Streamer yang memang offline dicek lebih jarang: tidak ada gunanya
      // menembak API TikTok tiap 2 detik sampai kena rate limit.
      delay = offline ? 60_000 : Math.min(delay * 2, 30_000);
    }
  }

  /** Membedakan event data dari event siklus koneksi (Connected/Disconnected). */
  handleConnectionEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload._tag === 'Event') {
      this.handle(payload.event);
      return;
    }
    if (payload._tag === 'Connected') {
      const room = payload.room ?? null;
      this.room = room
        ? {
            roomId: payload.roomId,
            title: room.title ?? '',
            viewers: room.viewerCount ?? null,
            owner: room.owner?.uniqueId ?? this.username,
            startedAt: room.streamStartedAt ?? null,
          }
        : { roomId: payload.roomId, title: '', viewers: null, owner: this.username, startedAt: null };
      this.setStatus('live', {
        message: this.room.title ? `Live: ${this.room.title}` : null,
        room: this.room,
        viewers: this.room.viewers,
      });
      logger.info('Tersambung ke live TikTok', this.room);
      return;
    }
    if (payload._tag === 'Disconnected') {
      const offline = payload.reason === 'offline' || payload.reason === 'streamEnd';
      this.setStatus(offline ? 'offline' : 'reconnecting', {
        message: payload.detail ?? (offline ? 'Live berakhir' : 'Koneksi terputus, menyambung ulang'),
        willReconnect: payload.willReconnect ?? false,
      });
    }
  }

  handle(event) {
    if (!event || typeof event !== 'object') return;
    const type = event.type ?? 'unknown';
    this.stats.events += 1;
    if (type === 'chat') this.stats.chats += 1;
    if (type === 'gift') this.stats.gifts += 1;
    if (type === 'like') this.stats.likes += 1;
    if (type === 'follow') this.stats.follows += 1;
    if (type === 'viewers') this.stats.viewers = event.viewerCount ?? null;

    this.emit('event', event);
    this.emit(type, event);
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    const fiber = this.fiber;
    this.fiber = null;
    this.room = null;
    if (fiber) {
      try {
        await Effect.runPromise(Fiber.interrupt(fiber));
      } catch {
        // fiber mungkin sudah selesai
      }
    }
    this.setStatus('stopped');
  }
}
