// Mengisi antrean dengan beberapa contoh supaya dashboard tidak kosong saat uji.
// Pakai: npm run seed:demo
// Tidak memproses apa pun — worker yang akan mengambilnya.

import { enqueueRequest, pendingVerifications } from '../services/queue.service.js';
import { logger } from '../lib/logger.js';

const samples = [
  { robloxUsername: 'Builderman', packageId: 'quick', tiktokUser: 'penonton_satu', source: 'chat' },
  { robloxUsername: 'Roblox', packageId: 'full', tiktokUser: 'penonton_dua', source: 'chat', txnCode: 'DEMO-TRX-1' },
  { robloxUsername: 'Builderman', packageId: 'vip_express', tiktokUser: 'penonton_tiga', source: 'gift', txnCode: 'DEMO-TRX-2' },
];

for (const sample of samples) {
  try {
    const result = enqueueRequest(sample);
    console.log(`#${result.request.id} ${sample.robloxUsername} -> ${result.request.status} (${result.message})`);
  } catch (err) {
    console.log(`Gagal menambah ${sample.robloxUsername}: ${err.message}`);
  }
}

console.log(`\nPembayaran menunggu verifikasi: ${pendingVerifications().length}`);
logger.info('Seed demo selesai');
