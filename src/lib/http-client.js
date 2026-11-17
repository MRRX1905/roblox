// Klien HTTP kecil untuk Roblox.
// - timeout per request
// - retry terbatas pada 429 dan 5xx, menghormati Retry-After
// - semua panggilan lewat RateLimiter

import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(message, { status, url, body, retryAfterMs } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header) {
  if (!header) return 0;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return 0;
}

/**
 * @param {string} url
 * @param {object} options
 * @param {import('./rate-limiter.js').RateLimiter} [options.limiter]
 * @param {string} [options.bucket]
 */
export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 10_000,
    retries = 2,
    limiter,
    bucket = 'default',
    expectJson = true,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (limiter) await limiter.acquire(bucket);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': 'roblox-live-review/0.1 (+local tool)',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError = new HttpError(`Permintaan gagal: ${method} ${url} (${err.name})`, { url });
      lastError.cause = err;
      // Galat jaringan/timeout layak dicoba ulang.
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const wait = retryAfterMs || Math.min(8000, 600 * 2 ** attempt);
      const text = await response.text().catch(() => '');
      lastError = new HttpError(`HTTP ${response.status} dari ${url}`, {
        status: response.status,
        url,
        body: text.slice(0, 300),
        retryAfterMs,
      });
      if (attempt < retries) {
        logger.warn('Roblox menolak permintaan, menunggu sebelum ulang', {
          status: response.status,
          url,
          waitMs: wait,
        });
        await sleep(wait);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HttpError(`HTTP ${response.status} dari ${url}`, {
        status: response.status,
        url,
        body: text.slice(0, 300),
      });
    }

    if (!expectJson) return response;
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(`Respons bukan JSON dari ${url}`, { url, body: text.slice(0, 300) });
    }
  }
  throw lastError;
}
