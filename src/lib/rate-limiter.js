// Token bucket per key (dipakai per host Roblox).
// Rate limit Roblox tanpa login dipotong drastis pada Okt 2026, jadi semua
// panggilan keluar harus lewat limiter ini.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  /**
   * @param {Record<string, {ratePerSec: number, burst?: number}>} config
   */
  constructor(config = {}) {
    this.config = config;
    this.buckets = new Map();
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      const conf = this.config[key] || this.config.default || { ratePerSec: 5, burst: 5 };
      b = { tokens: conf.burst ?? conf.ratePerSec, last: Date.now(), ...conf, max: conf.burst ?? conf.ratePerSec };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Menunggu sampai 1 token tersedia, lalu memakainya. */
  async acquire(key, { signal } = {}) {
    const b = this.bucket(key);
    // Jangan menunggu tanpa batas kalau konfigurasi rate-nya masuk akal.
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error('Dibatalkan saat menunggu rate limit'), { code: 'ABORTED' });
      const now = Date.now();
      const elapsed = (now - b.last) / 1000;
      b.tokens = Math.min(b.max, b.tokens + elapsed * b.ratePerSec);
      b.last = now;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      if (now > deadline) {
        throw Object.assign(new Error(`Rate limit ${key} tidak tersedia dalam 60 detik`), { code: 'RATE_LIMIT_WAIT' });
      }
      const need = (1 - b.tokens) / b.ratePerSec;
      await sleep(Math.max(20, Math.ceil(need * 1000)));
    }
  }
}

// Batas konservatif, jauh di bawah angka resmi (users 100/s tanpa login),
// supaya banyak review berurutan tidak memicu 429.
export const robloxLimiter = new RateLimiter({
  users: { ratePerSec: 20, burst: 20 },
  thumbnails: { ratePerSec: 8, burst: 8 },
  friends: { ratePerSec: 4, burst: 4 },
  inventory: { ratePerSec: 0.5, burst: 2 },
  catalog: { ratePerSec: 10, burst: 10 },
  economy: { ratePerSec: 5, burst: 5 },
  default: { ratePerSec: 5, burst: 5 },
});
