# Roblox Live Review

Sistem otomasi review akun Roblox untuk TikTok LIVE: membaca komentar dan gift, mengambil data publik akun Roblox, menghitung statistik, menulis naskah review, membacakannya lewat TTS, dan menampilkan overlay untuk OBS.

Berjalan lokal di Windows. Tanpa API berbayar, tanpa login Roblox, tanpa cookie TikTok.

---

## 1. Yang benar-benar bisa dilakukan sistem ini

Ini bagian penting, karena sebagian klaim blueprint awal tidak lagi mungkin per 2026.

| Klaim | Kenyataan |
|---|---|
| "Hitung total nilai seluruh inventory" | **Tidak bisa.** Roblox menegakkan privasi inventory di semua endpoint web sejak Jan 2026, dan Open Cloud hanya bisa membaca inventory milik pemilik API key. Yang dihitung sistem ini: **nilai outfit yang sedang dipakai** + **daftar Limited yang terlihat publik**. |
| "Rata-rata harga item" | Bisa, untuk item yang masih punya harga publik. Item lama yang sudah tidak dijual ditampilkan sebagai `Unavailable`, bukan 0. |
| "Avatar 3D" | Endpoint 3D menolak permintaan tanpa login (403). Overlay memakai thumbnail 2D (avatar penuh + headshot). |
| "Balas komentar otomatis" | Tidak. `tiklive` read-only; sistem hanya menampilkan notifikasi di dashboard/overlay. |
| "Baca komentar LIVE resmi" | TikTok tidak punya API publik untuk komentar LIVE. Sistem memakai protokol privat lewat library `tiklive` (MIT). Bisa berubah sewaktu-waktu. |

Harga yang ditampilkan adalah **harga katalog / resale saat ini**, bukan total uang yang pernah dikeluarkan pemilik akun. Naskah review selalu menyebut ini.

---

## 2. Mulai cepat

```bash
npm install
copy .env.example .env      # Windows; atau: cp .env.example .env
npm start
```

Buka <http://127.0.0.1:3210>.

1. Pilih mode **demo**, tekan **Start Live Monitor** → sistem menghasilkan chat & gift palsu.
2. Ketik `!review Builderman` di panel "Tambah manual" (atau tunggu komentar demo).
3. Review berjalan: data Roblox → naskah → audio → diputar → `completed`.

Untuk live sungguhan: pilih mode **live**, isi username TikTok, lalu Start.

### Perintah yang dikenali di chat

| Komentar | Aksi |
|---|---|
| `!review <username>` | Quick review (gratis) |
| `!full <username>` | Full review → menunggu verifikasi pembayaran |
| `!queue` | Menampilkan jumlah antrean |

Anti-spam: cooldown per user TikTok, maksimal satu pekerjaan aktif per user, dedupe event berdasarkan `msgId`.

---

## 3. Paket & prioritas

| Paket | Harga | Prioritas | Catatan |
|---|---|---|---|
| Quick Review | gratis | 10 | dari `!review` |
| Fast Track | gift | 50 | dipetakan dari gift TikTok |
| Full Review | Rp5.000 | 40 | butuh verifikasi manual |
| VIP Express | Rp10.000 | 100 | suara default memakai `tts.altVoice` |

Harga dan benefit ada di [`src/config/pricing.js`](src/config/pricing.js). Fairness: maksimal 2 pekerjaan prioritas berturut-turut, lalu satu pekerjaan normal dilayani (`queue.maxConsecutivePriority`).

Pembayaran diverifikasi manual oleh admin di panel **Pembayaran menunggu** (Setujui / Tolak). Tidak ada integrasi payment gateway: SosialBuzz tidak punya API pembayaran publik yang bisa dipastikan, jadi sistem tidak menebak endpoint.

### Memetakan gift

Gift belum dipetakan secara default. Untuk memetakannya:

1. Jalankan mode live, kirim gift.
2. Lihat log/dashboard: `Gift belum dipetakan ke paket { giftId, giftName }`.
3. Isi [`src/config/gifts.js`](src/config/gifts.js): `'<giftId>': 'fast_track'` atau `'vip_express'`.

Hanya event gift dengan `streaking: false` (combo selesai) yang diproses. `diamondCount` dicatat sebagai diamond, **tidak pernah** dianggap sebagai jumlah koin yang dibayar penonton.

---

## 4. Suara: VB-Cable + OBS

### Suara yang tersedia

- `id-ID-ArdiNeural` (pria, default)
- `id-ID-GadisNeural` (wanita, default untuk VIP)

Dihasilkan lewat `msedge-tts` (murni Node). Setiap klip dinormalisasi `loudnorm` dan diubah ke 48 kHz stereo sebelum diputar.

### Routing audio ke OBS

1. Install **VB-Cable** (`VBCABLE_Driver_Pack`, jalankan installer sebagai administrator, lalu reboot). Ini langkah manual — butuh hak admin dan tidak dilakukan otomatis.
2. Cek nama device:
   ```bash
   npm run audio:devices
   ```
3. Isi **Settings → Device audio** dengan nama persis, mis. `CABLE Input (VB-Audio Virtual Cable)`.
4. Di OBS: tambah **Audio Input Capture** → pilih `CABLE Output (VB-Audio Virtual Cable)`.

Kalau device yang diminta tidak ada, audio diulang di device default Windows dan dashboard menampilkan warning — tidak gagal diam-diam.

### Scene OBS

| Scene | Browser Source |
|---|---|
| Main Live | `http://127.0.0.1:3210/overlays/current-review.html` (1920×1080) |
| Queue | `http://127.0.0.1:3210/overlays/queue.html` |
| Alerts | `http://127.0.0.1:3210/overlays/alerts.html` |

Overlay memperbarui diri lewat SSE (`/api/events`), jadi tidak perlu refresh.

### Kontrol suara di dashboard

- **Skip** — menghentikan audio sekarang dan menandai review `completed` (catatan: dilewati admin).
- **Pause antrean** — berhenti mengambil audio berikutnya; kalimat yang sedang berjalan tidak dipotong.
- **Mute** — melewati pemutaran, review tetap ditandai selesai (naskah tetap tampil di overlay).
- **Emergency Stop** — menghentikan audio, membatalkan semua audio menunggu, dan mengembalikan review ke `waiting` tanpa menghapus datanya.

Pause tidak memotong kalimat karena `ffplay` tidak menyediakan kontrol pause yang andal tanpa jendela di Windows.

---

## 5. AI (opsional, default mati)

Default: naskah dibuat dari template deterministik. Tidak bisa mengarang angka, tidak butuh GPU.

Untuk menyalakan Ollama: **Settings → Pakai AI (Ollama)**, model default `qwen3.5:9b`.

Pengaman saat AI aktif:

- `think: false` + blok reasoning dibersihkan.
- Semua angka ≥ 11 di naskah harus ada di dataset; kalau tidak, naskah AI dibuang dan template dipakai.
- Timeout 60 detik.

Di CPU, 9B butuh 30–90 detik per naskah. Untuk live ramai, biarkan AI mati atau turunkan ke model 4B.

---

## 6. Arsitektur

```
TikTok LIVE ── tiklive/core ──> listener ──> comment/gift parser ──> queue (SQLite)
                                                                        │
                              worker: Roblox API ─> analysis ─> narration ─> TTS
                                                                        │
                                                            speech queue (serial)
                                                                        │
                                                       ffplay → VB-Cable → OBS
```

Struktur folder:

```
src/
  config/        settings default, paket & prioritas, mapping gift
  lib/           http client, rate limiter, cache, logger, angka bahasa Indonesia
  database/      schema + repo (node:sqlite, tanpa native dependency)
  integrations/  roblox/, tiktok/, tts/, audio/
  services/      roblox, analysis, narration, tts, queue, worker, speech-queue, payment, events
  routes/        dashboard, queue, review, settings, tiktok, audio, payments, overlay
  scripts/       probe-roblox, probe-tts, list-audio-devices, seed-demo
public/          dashboard.html, css, js, overlays/
storage/         database, audio cache, report
```

### Status pekerjaan

`waiting → processing → generating_audio → playing → completed`

Gagal: `failed` (admin bisa **Ulangi** tanpa membuat pembayaran baru). `generating_audio` berarti audio sudah siap dan menunggu giliran diputar.

Saat restart, request `processing`/`playing` dikembalikan ke `waiting`; request yang sudah punya file audio tidak di-TTS ulang.

### Endpoint Roblox yang dipakai

| Data | Endpoint | Catatan |
|---|---|---|
| username → id | `POST users.roblox.com/v1/usernames/users` | |
| profil | `GET users.roblox.com/v1/users/{id}` | deskripsi bisa kosong |
| avatar terpakai | `GET avatar.roblox.com/v4/avatar/users/{id}` | fallback `currently-wearing` (hidup sampai 11 Des 2026) |
| thumbnail | `thumbnails.roblox.com/v1/users/avatar`, `avatar-headshot` | polling state `Pending` |
| sosial | `friends.roblox.com/.../{friends,followers,followings}/count` | paling sering 429 → ditandai `unavailable` |
| Limited | `inventory.roblox.com/v1/users/{id}/assets/collectibles` | cek `can-view-inventory` |
| bundle | `catalog.roblox.com/v1/users/{id}/bundles` | menambal dynamic head yang hilang |
| harga | `POST catalog.roblox.com/v1/catalog/items/details` | butuh handshake `x-csrf-token` (403 → ulang) |
| fallback harga | `economy.roblox.com/v2/assets/{id}/details` | saat batch ditolak |

Semua panggilan lewat rate limiter per host + cache SQLite (profil 10 menit, harga 1 jam).

---

## 7. Skrip uji

```bash
npm test                                  # 28 unit test (parser, antrean, analisis, narasi, angka)
npm run probe:roblox -- Roblox            # dump JSON mentah semua endpoint Roblox
npm run probe:tts                         # tes 2 suara Indonesia, tulis sample mp3
npm run audio:devices                     # daftar nama device audio Windows
npm run seed:demo                         # isi antrean contoh
```

`probe:roblox` penting: kalau Roblox mengubah bentuk respons lagi, jalankan ini dulu sebelum mengubah parser.

---

## 8. Batasan & risiko

- **TikTok**: protokol privat, bukan API resmi. `tiklive` read-only, **tidak punya resume cursor** (event bisa hilang saat reconnect), dan menolak koneksi dari IP datacenter/VPN. ToS TikTok melarang ekstraksi data otomatis; risikonya menimpa akun streaming. Jangan pakai akun utama untuk uji.
- **Roblox**: rate limit tanpa login dipotong drastis (Okt 2026: users 1000→100 req/detik). `friends.roblox.com` paling agresif. Inventory privat bukan berarti kosong. Kebijakan penggunaan Roblox melarang "profiling users"; alat ini hanya membaca data publik yang memang bisa diakses siapa pun.
- **edge-tts**: tidak resmi. Microsoft pernah mematahkannya (Okt 2026, diperbaiki di versi Python 7.3.1). Kalau mati lagi: aktifkan `tts.pythonFallback` (`pip install edge-tts`) atau review tetap jalan dengan naskah tampil di overlay.
- **Tanpa cookie**: sistem tidak menyimpan cookie TikTok/Roblox siapa pun.
- **Data**: semua di SQLite lokal (`storage/roblox-live-review.sqlite`).

---

## 9. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| `EADDRINUSE` | Port 3210 dipakai proses lain. Set `PORT=3211` di `.env`. |
| Audio tidak masuk OBS | Device di Settings salah nama. Jalankan `npm run audio:devices`, salin nama persis. |
| `TTS gagal` | Cek `npm run probe:tts`. Kalau 403: aktifkan python fallback. |
| Batch harga 403 | Handshake XSRF gagal; sistem otomatis fallback ke `economy/v2` per item (lebih lambat). |
| Semua data sosial `Unavailable` | 429 dari `friends.roblox.com`. Tunggu beberapa menit, cache akan mengisi. |
| Gift tidak menaikkan prioritas | Belum dipetakan di `src/config/gifts.js`, atau combo belum selesai (`streaking`). |
| Review berhenti di `generating_audio` | Audio siap tapi menunggu giliran; cek panel Kontrol suara. Bisa jadi antrean sedang dijeda. |
