import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComment, extractCommand } from '../src/integrations/tiktok/comment-parser.js';

test('mengenali !review dengan username valid', () => {
  const result = parseComment('!review Rafixx123');
  assert.equal(result.command, 'review');
  assert.equal(result.username, 'Rafixx123');
  assert.equal(result.error, null);
});

test('mengenali !full dan menormalkan spasi berlebih', () => {
  const result = parseComment('   !FULL    Rafixx123   ');
  assert.equal(result.command, 'full');
  assert.equal(result.username, 'Rafixx123');
});

test('menerima @ di depan username', () => {
  assert.equal(parseComment('!review @Rafixx123').username, 'Rafixx123');
});

test('!queue tidak butuh username', () => {
  const result = parseComment('!queue');
  assert.equal(result.command, 'queue');
  assert.equal(result.username, null);
  assert.equal(result.error, null);
});

test('komentar biasa bukan command', () => {
  assert.equal(parseComment('halo kak, review dong').command, null);
  assert.equal(parseComment('!review').command, 'review');
  assert.equal(parseComment('!review').error, 'USERNAME_MISSING');
});

test('username tidak valid ditolak', () => {
  assert.equal(parseComment('!review ab').error, 'USERNAME_INVALID');
  assert.equal(parseComment('!review a_very_long_roblox_username_here').error, 'USERNAME_INVALID');
  assert.equal(parseComment('!review bad-name!').error, 'USERNAME_INVALID');
});

test('command hanya dikenali di awal komentar', () => {
  assert.equal(extractCommand('tolong !review Rafixx123'), null);
});

test('hanya token pertama setelah command yang dipakai', () => {
  const result = parseComment('!review Rafixx123 tolong ya');
  assert.equal(result.username, 'Rafixx123');
  assert.equal(result.error, null);
});
