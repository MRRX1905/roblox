import test from 'node:test';
import assert from 'node:assert/strict';
import { integerToWords, decimalToWords, spellNumbersInText, formatNumberId } from '../src/lib/numbers-id.js';

test('bilangan dasar', () => {
  assert.equal(integerToWords(0), 'nol');
  assert.equal(integerToWords(7), 'tujuh');
  assert.equal(integerToWords(11), 'sebelas');
  assert.equal(integerToWords(19), 'sembilan belas');
  assert.equal(integerToWords(20), 'dua puluh');
  assert.equal(integerToWords(100), 'seratus');
  assert.equal(integerToWords(1000), 'seribu');
  assert.equal(integerToWords(2450), 'dua ribu empat ratus lima puluh');
  assert.equal(integerToWords(1_000_000), 'satu juta');
});

test('desimal', () => {
  assert.equal(decimalToWords(8.7), 'delapan koma tujuh');
});

test('angka di dalam teks dieja, termasuk ribuan dan desimal', () => {
  assert.equal(
    spellNumbersInText('Totalnya 2.450 Robux, rating 8,7 dari 10.'),
    'Totalnya dua ribu empat ratus lima puluh Robux, rating delapan koma tujuh dari sepuluh.',
  );
  assert.equal(spellNumbersInText('umur 20.7 tahun'), 'umur dua puluh koma tujuh tahun');
});

test('format tampilan memakai pemisah ribuan Indonesia', () => {
  assert.equal(formatNumberId(1234567), '1.234.567');
});
