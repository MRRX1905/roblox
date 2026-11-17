// Logger sederhana: console + ring buffer supaya dashboard bisa menampilkan log terakhir.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BUFFER = 300;

const buffer = [];
const subscribers = new Set();

function push(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    meta: meta && typeof meta === 'object' ? meta : meta === undefined ? undefined : { value: meta },
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  for (const fn of subscribers) {
    try {
      fn(entry);
    } catch {
      // Subscriber dashboard tidak boleh menjatuhkan proses.
    }
  }
  return entry;
}

function emit(level) {
  return (message, meta) => {
    const entry = push(level, message, meta);
    if (LEVELS[level] < LEVELS[process.env.LOG_LEVEL || 'info']) return entry;
    const suffix = entry.meta ? ` ${safeJson(entry.meta)}` : '';
    const line = `[${entry.time}] ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return entry;
  };
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

export const logger = {
  debug: emit('debug'),
  info: emit('info'),
  warn: emit('warn'),
  error: emit('error'),
  recent(limit = 100) {
    return buffer.slice(-limit);
  },
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};
