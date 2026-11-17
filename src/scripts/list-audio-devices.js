// Menampilkan device audio Windows, untuk mengisi settings.audio.device.
// ffplay memakai nama device persis seperti yang dilaporkan Windows/SDL.

import { spawnSync } from 'node:child_process';

const script = `
$ErrorActionPreference = 'SilentlyContinue'
$out = [System.Collections.ArrayList]@()
Get-CimInstance Win32_SoundDevice | ForEach-Object {
  [void]$out.Add([pscustomobject]@{ kind = 'soundcard'; name = $_.Name })
}
Get-PnpDevice -Class AudioEndpoint | ForEach-Object {
  [void]$out.Add([pscustomobject]@{ kind = 'endpoint'; name = $_.FriendlyName })
}
$out | ConvertTo-Json -Compress
`;

const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
if (result.error) {
  console.error('Gagal menjalankan PowerShell:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr || 'PowerShell keluar dengan kode ' + result.status);
  process.exit(result.status ?? 1);
}

let devices = [];
try {
  const parsed = JSON.parse(result.stdout.trim() || '[]');
  devices = Array.isArray(parsed) ? parsed : [parsed];
} catch (err) {
  console.error('Output PowerShell tidak bisa dibaca:', err.message);
  console.error(result.stdout.slice(0, 500));
  process.exit(1);
}

const unique = [...new Set(devices.map((d) => d.name).filter(Boolean))];
console.log('Kandidat nama device (salin yang persis ke settings.audio.device):\n');
for (const name of unique) console.log(`  - ${name}`);
console.log('\nContoh: "CABLE Input (VB-Audio Virtual Cable)" setelah VB-Cable terpasang,');
console.log('atau kosongkan settings.audio.device untuk memakai device default Windows.');
console.log('\nDevice dengan nama "Voicemod" bisa dipakai sebagai tujuan sementara,');
console.log('tapi pastikan OBS menangkap output yang benar agar tidak dobel audio.');
