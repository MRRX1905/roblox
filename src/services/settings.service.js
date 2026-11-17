// Pembacaan/penulisan settings. Nilai disimpan per bagian (top-level key) di SQLite,
// lalu digabung dengan DEFAULTS supaya setting baru tetap ada setelah update kode.

import { DEFAULTS, mergeSettings } from '../config/settings.js';
import { deleteSetting, readSettingsRows, writeSetting } from '../database/repositories/system.repo.js';
import { logger } from '../lib/logger.js';

let cached = null;

export function getSettings() {
  if (!cached) cached = mergeSettings(DEFAULTS, readSettingsRows());
  return cached;
}

export function updateSettings(patch) {
  const unknown = Object.keys(patch).filter((key) => !(key in DEFAULTS));
  if (unknown.length > 0) {
    const err = new Error(`Setting tidak dikenal: ${unknown.join(', ')}`);
    err.code = 'UNKNOWN_SETTING';
    throw err;
  }
  const merged = mergeSettings(getSettings(), patch);
  for (const key of Object.keys(patch)) writeSetting(key, merged[key]);
  cached = merged;
  logger.info('Settings diperbarui', { keys: Object.keys(patch) });
  return merged;
}

export function resetSettings() {
  for (const key of Object.keys(DEFAULTS)) deleteSetting(key);
  cached = mergeSettings(DEFAULTS, {});
  return cached;
}

/** Nilai yang aman ditampilkan ke dashboard (tidak ada rahasia di sini). */
export function getPublicSettings() {
  return getSettings();
}
