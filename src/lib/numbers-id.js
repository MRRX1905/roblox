// Angka -> kata bahasa Indonesia, untuk naskah TTS.
// "2.450 Robux" harus dibacakan "dua ribu empat ratus lima puluh Robux".

const SATUAN = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function below100(n) {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) {
    const puluh = Math.floor(n / 10);
    const sisa = n % 10;
    return sisa === 0 ? `${SATUAN[puluh]} puluh` : `${SATUAN[puluh]} puluh ${SATUAN[sisa]}`;
  }
  return null;
}

function below1000(n) {
  if (n < 100) return below100(n);
  const ratus = Math.floor(n / 100);
  const sisa = n % 100;
  const head = ratus === 1 ? 'seratus' : `${SATUAN[ratus]} ratus`;
  return sisa === 0 ? head : `${head} ${below100(sisa)}`;
}

/** Bilangan bulat non-negatif sampai triliunan. */
export function integerToWords(input) {
  const n = Math.trunc(Number(input));
  if (!Number.isFinite(n) || n < 0) return String(input);
  if (n === 0) return 'nol';
  if (n < 1000) return below1000(n);

  const units = [
    { value: 1_000_000_000_000, name: 'triliun' },
    { value: 1_000_000_000, name: 'miliar' },
    { value: 1_000_000, name: 'juta' },
    { value: 1_000, name: 'ribu' },
  ];

  let rest = n;
  const parts = [];
  for (const unit of units) {
    if (rest >= unit.value) {
      const count = Math.floor(rest / unit.value);
      rest %= unit.value;
      // "seribu", bukan "satu ribu"; "seratus ribu" tetap "seratus ribu".
      if (unit.name === 'ribu' && count === 1) parts.push('seribu');
      else parts.push(`${integerToWords(count)} ${unit.name}`);
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 8.7 -> "delapan koma tujuh" */
export function decimalToWords(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return String(input);
  const [whole, frac] = String(Number(n.toFixed(1))).split('.');
  if (!frac) return integerToWords(whole);
  return `${integerToWords(whole)} koma ${integerToWords(frac)}`;
}

/**
 * Ganti semua angka di dalam teks dengan kata-katanya.
 * "2.450 Robux, rating 8,7" -> "dua ribu empat ratus lima puluh Robux, rating delapan koma tujuh"
 */
export function spellNumbersInText(text) {
  if (typeof text !== 'string') return '';
  return text
    // Desimal gaya Indonesia: 8,7
    .replace(/\b(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})\b/g, (_, whole, frac) => {
      return `${integerToWords(Number(whole.replace(/\./g, '')))} koma ${integerToWords(Number(frac))}`;
    })
    // Desimal gaya Inggris yang lolos: 20.7 (1-2 digit di belakang titik = desimal).
    // 2.450 tidak kena aturan ini karena tiga digit di belakang titik.
    .replace(/\b(\d+)\.(\d{1,2})\b/g, (_, whole, frac) => {
      return `${integerToWords(Number(whole))} koma ${integerToWords(Number(frac))}`;
    })
    // Ribuan gaya Indonesia: 2.450
    .replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (m) => integerToWords(Number(m.replace(/\./g, ''))))
    // Angka biasa
    .replace(/\b(\d+)\b/g, (m) => integerToWords(Number(m)));
}

/** 1234 -> "1.234" (pemisah ribuan gaya Indonesia, untuk tampilan layar). */
export function formatNumberId(n) {
  const value = Math.trunc(Number(n));
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('id-ID');
}
