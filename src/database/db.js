// Koneksi SQLite memakai modul bawaan Node 24 (node:sqlite).
// Tidak ada native dependency, tidak ada node-gyp — penting di Windows.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, 'schema.sql');

let db;

export function dataDir() {
  return resolve(process.env.DATA_DIR || 'storage');
}

export function getDb() {
  if (db) return db;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'audio'), { recursive: true });
  mkdirSync(join(dir, 'cache'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });

  const file = process.env.DB_FILE || join(dir, 'roblox-live-review.sqlite');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(readFileSync(schemaPath, 'utf8'));
  logger.info('Database siap', { file });
  return db;
}

export function closeDb() {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = undefined;
  }
}

/** Urutan kolom dijamin sama dengan nama kolom SELECT untuk pemakaian internal. */
export function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

export function get(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

export function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

export function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Transaksi mungkin sudah dibatalkan SQLite.
    }
    throw err;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
