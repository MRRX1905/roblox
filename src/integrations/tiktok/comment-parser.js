// Parser komentar TikTok.
// Format yang dikenali (hanya di awal komentar):
//   !review <username>   -> quick review
//   !full <username>     -> full review (butuh pembayaran)
//   !queue               -> lihat antrean

import { isValidRobloxUsername } from '../roblox/users.js';
import { DEFAULTS } from '../../config/settings.js';

const COMMAND_KIND = {
  '!review': 'review',
  '!full': 'full',
  '!queue': 'queue',
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mengembalikan jenis command kalau komentar dibuka dengan salah satu command.
 * @returns {'review'|'full'|'queue'|null}
 */
export function extractCommand(text, commands = DEFAULTS.tiktok.commands) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim();
  for (const [key, kind] of Object.entries(COMMAND_KIND)) {
    const pattern = commands?.[kind] ?? key;
    if (!pattern) continue;
    const re = new RegExp(`^${escapeRegExp(pattern)}(?=\\s|$)`, 'i');
    if (re.test(cleaned)) return kind;
  }
  return null;
}

/**
 * @returns {{command: 'review'|'full'|'queue'|null, username: string|null, error: string|null, raw: string}}
 */
export function parseComment(text, commands = DEFAULTS.tiktok.commands) {
  const raw = typeof text === 'string' ? text : '';
  const command = extractCommand(raw, commands);
  if (!command) return { command: null, username: null, error: null, raw };

  if (command === 'queue') return { command, username: null, error: null, raw };

  const cleaned = raw.trim();
  const usedPattern = commands?.[command] ?? (command === 'full' ? '!full' : '!review');
  const rest = cleaned.slice(usedPattern.length).trim();
  const token = rest.split(/\s+/)[0] ?? '';
  const username = token.replace(/^@+/, '');

  if (!username) return { command, username: null, error: 'USERNAME_MISSING', raw };
  if (!isValidRobloxUsername(username)) return { command, username: null, error: 'USERNAME_INVALID', raw };

  return { command, username, error: null, raw };
}
