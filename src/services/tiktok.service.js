// Jembatan TikTok LIVE -> antrean.
//
// Read-only: sistem ini tidak mengirim chat balasan (tiklive tidak bisa menulis).
// Notifikasi ke penonton terjadi lewat dashboard dan overlay OBS.

import { TikTokListener } from '../integrations/tiktok/listener.js';
import { parseComment } from '../integrations/tiktok/comment-parser.js';
import { normalizeGiftEvent, shouldProcessGift } from '../integrations/tiktok/gift-parser.js';
import { findLatestActiveByTiktokUser, logGift, updateRequest } from '../database/repositories/requests.repo.js';
import { markEventSeen } from '../database/repositories/system.repo.js';
import { enqueueRequest } from './queue.service.js';
import { getSettings } from './settings.service.js';
import { getPackage } from '../config/pricing.js';
import { GIFT_MAPPING } from '../config/gifts.js';
import * as events from './events.service.js';
import { logger } from '../lib/logger.js';

let listener = null;
let status = { state: 'idle', mode: null, username: null, stats: null, message: null };
// Gift tak terpetakan hanya diperingatkan sekali per sesi: di live ramai, gift
// kecil bisa masuk puluhan kali per menit dan membanjiri overlay.
const unmappedGiftAlerts = new Set();

function publishStatus(next) {
  status = { ...status, ...next };
  events.updateState({ tiktok: { ...status, ...(next.stats ? { stats: next.stats } : {}) } });
}

function alert(kind, message, extra = {}) {
  events.setAlert({ kind, message, ...extra });
}

function handleChat(event, settings) {
  if (!markEventSeen(event.msgId)) return;
  const parsed = parseComment(event.comment, settings.tiktok.commands);
  const tiktokUser = event.user?.uniqueId ?? null;

  if (!parsed.command) return;
  if (parsed.command === 'queue') {
    const queue = events.getOverlayState().queue ?? [];
    alert('queue', `Antrean sekarang: ${queue.length} permintaan`, { queue });
    return;
  }

  if (parsed.error === 'USERNAME_MISSING') {
    alert('command', `Ketik username Roblox-nya juga ya, contoh: ${settings.tiktok.commands.review} Rafixx123`, { tiktokUser });
    return;
  }
  if (parsed.error === 'USERNAME_INVALID') {
    alert('command', `Username "${parsed.username ?? ''}" tidak valid. Pakai 3-20 huruf/angka/underscore.`, { tiktokUser });
    return;
  }

  const packageId = parsed.command === 'full' ? 'full' : 'quick';
  try {
    const result = enqueueRequest({
      tiktokUser,
      robloxUsername: parsed.username,
      packageId,
      source: 'chat',
      messageId: event.msgId,
      note: `Komentar TikTok: ${event.comment.slice(0, 120)}`,
    });
    const pkg = getPackage(packageId);
    alert('request', `${tiktokUser ?? 'Penonton'} meminta ${pkg.label} untuk ${parsed.username}`, {
      tiktokUser,
      username: parsed.username,
      package: pkg.label,
      requestId: result.request.id,
    });
  } catch (err) {
    if (err.code === 'COOLDOWN' || err.code === 'TOO_MANY_ACTIVE' || err.code === 'UNKNOWN_PACKAGE') {
      alert('command', err.message, { tiktokUser, username: parsed.username });
      return;
    }
    logger.error('Gagal memasukkan request dari chat', { error: err.message, username: parsed.username });
    alert('error', `Gagal memproses permintaan ${parsed.username}: ${err.message}`);
  }
}

function handleGift(event) {
  if (!markEventSeen(event.msgId)) return;
  const settings = getSettings();
  // Mapping dari config/gifts.js; nilai yang dipetakan lewat settings menimpanya.
  const mapping = { ...GIFT_MAPPING, ...(settings.tiktok.giftMapping ?? {}) };
  const gift = normalizeGiftEvent(event, mapping);
  const record = logGift({
    tiktokUser: gift.tiktokUser,
    giftId: gift.giftId ?? 'unknown',
    giftName: gift.giftName,
    diamonds: gift.totalDiamonds,
    repeatCount: gift.repeatCount,
    tier: gift.tier,
  });

  if (!gift.isFinal) {
    logger.debug('Gift streaking diabaikan sampai combo selesai', { gift: gift.giftName, repeat: gift.repeatCount });
    return;
  }

  if (!gift.packageId) {
    logger.info('Gift belum dipetakan ke paket', { giftId: gift.giftId, giftName: gift.giftName, diamonds: gift.diamondCount });
    const alertKey = String(gift.giftId ?? gift.giftName ?? 'unknown');
    if (!unmappedGiftAlerts.has(alertKey)) {
      unmappedGiftAlerts.add(alertKey);
      alert('gift', `Gift ${gift.giftName ?? gift.giftId} diterima dari ${gift.tiktokUser}, belum dipetakan ke paket`, {
        giftId: gift.giftId,
        tiktokUser: gift.tiktokUser,
      });
    }
    return;
  }

  if (shouldProcessGift(gift)) {
    const target = findWaitingForTiktokUser(gift.tiktokUser);
    if (target) {
      const pkg = getPackage(gift.packageId);
      updateRequest(target.id, { package: pkg.id, priority: pkg.priority });
      alert('gift', `${gift.tiktokUser} mengirim ${gift.giftName}: ${target.roblox_username} naik ke ${pkg.label}`, {
        giftId: gift.giftId,
        tiktokUser: gift.tiktokUser,
        requestId: target.id,
      });
    } else {
      alert('gift', `${gift.tiktokUser} mengirim ${gift.giftName}. Ketik ${settings.tiktok.commands.review} username untuk pakai prioritasnya.`, {
        giftId: gift.giftId,
        tiktokUser: gift.tiktokUser,
      });
    }
  }
  logger.info('Gift diproses', { gift: gift.giftName, tier: gift.tier, requestId: record?.request_id ?? null });
}

function findWaitingForTiktokUser(tiktokUser) {
  if (!tiktokUser) return null;
  return findLatestActiveByTiktokUser(tiktokUser);
}

export async function startTikTok({ mode, username } = {}) {
  await stopTikTok();
  const settings = getSettings();
  const nextMode = mode ?? settings.tiktok.mode ?? 'demo';
  const nextUsername = username ?? settings.tiktok.username ?? 'demo';

  unmappedGiftAlerts.clear();
  status = { state: 'idle', mode: nextMode, username: nextUsername, stats: null, message: null, room: null };
  events.updateState({ tiktok: { ...status } });
  listener = new TikTokListener({ mode: nextMode, username: nextUsername });

  listener.on('status', (payload) => {
    publishStatus({ ...payload, message: payload.message ?? null });
  });
  listener.on('chat', (event) => handleChat(event, getSettings()));
  listener.on('gift', (event) => handleGift(event));
  listener.on('follow', (event) => {
    alert('follow', `${event.user?.nickname ?? event.user?.uniqueId} mulai mengikuti`);
  });
  listener.on('share', (event) => {
    alert('share', `${event.user?.nickname ?? event.user?.uniqueId} membagikan live`);
  });
  listener.on('viewers', (event) => {
    events.updateState({ tiktok: { ...status, viewers: event.viewerCount ?? null } });
  });
  listener.on('like', () => {
    // Like sangat sering; cukup agregat, jangan membanjiri overlay.
  });

  await listener.start();
  logger.info('Listener TikTok dimulai', { mode: nextMode, username: nextUsername });
  return getTikTokStatus();
}

export async function stopTikTok() {
  if (!listener) return;
  const previous = listener;
  listener = null;
  await previous.stop();
  publishStatus({ state: 'stopped', room: null, message: null });
  logger.info('Listener TikTok dihentikan');
}

/**
 * Menyuntikkan komentar uji ke pipeline yang sama dengan komentar asli.
 * Dipakai untuk menguji alur perintah saat live, karena aplikasi ini hanya
 * membaca chat dan tidak bisa menulis komentar ke TikTok.
 * Tidak dihitung ke statistik live supaya angka di dashboard tetap jujur.
 */
export function simulateChat({ comment, tiktokUser = 'uji_perintah', nickname } = {}) {
  if (!listener?.running) {
    const error = new Error('Listener TikTok belum berjalan. Mulai mode live atau demo dulu.');
    error.code = 'LISTENER_OFFLINE';
    throw error;
  }
  const event = {
    type: 'chat',
    timestamp: Date.now(),
    msgId: `uji-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    comment,
    user: { userId: '0', uniqueId: tiktokUser, nickname: nickname ?? tiktokUser },
    simulated: true,
  };
  listener.emit('event', event);
  listener.emit('chat', event);
  return { msgId: event.msgId, tiktokUser: event.user.uniqueId, comment };
}

export function getTikTokStatus() {
  if (listener) {
    return {
      state: listener.state,
      mode: listener.mode,
      username: listener.username,
      stats: listener.stats,
      room: listener.room,
      lastError: listener.lastError,
    };
  }
  return { ...status };
}

export function isTikTokRunning() {
  return !!listener?.running;
}
