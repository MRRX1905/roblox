const $ = (id) => document.getElementById(id);

let settings = null;
let voices = [];
let lastAlertAt = 0;
let paused = false;
let muted = false;

const fmt = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('id-ID'));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

let toastTimer;
function toast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 6000);
}

function statusPill(state) {
  const el = $('tiktok-status');
  const value = state || 'idle';
  el.textContent = value;
  el.className = `pill pill-${['live', 'demo', 'error', 'offline', 'connecting'].includes(value) ? value : 'idle'}`;
}

function renderTikTok(tiktok) {
  if (!tiktok) return;
  statusPill(tiktok.state);
  const stats = tiktok.stats ?? {};
  const bits = [];
  if (tiktok.mode) bits.push(`mode ${tiktok.mode}`);
  if (tiktok.username) bits.push(`@${tiktok.username}`);
  if (stats.events) bits.push(`${fmt(stats.events)} event`);
  if (stats.chats) bits.push(`${fmt(stats.chats)} chat`);
  if (stats.gifts) bits.push(`${fmt(stats.gifts)} gift`);
  if (stats.viewers != null) bits.push(`${fmt(stats.viewers)} penonton`);
  if (tiktok.lastError) bits.push(`error: ${tiktok.lastError}`);
  $('tiktok-detail').textContent = bits.length ? bits.join(' · ') : 'Listener belum berjalan.';
}

function tagFor(pkg) {
  return `<span class="tag tag-${pkg}">${pkg.replace('_', ' ')}</span>`;
}

function renderQueue(waiting = [], active = []) {
  const rows = [
    ...active.map((r) => ({ ...r, active: true })),
    ...waiting.map((r, i) => ({ ...r, position: i + 1 })),
  ];
  $('queue-count').textContent = `${waiting.length} menunggu`;

  if (rows.length === 0) {
    $('queue-body').innerHTML = '<tr><td colspan="6" class="muted">Belum ada permintaan.</td></tr>';
    return;
  }

  $('queue-body').innerHTML = rows
    .map((r) => {
      const pos = r.active ? '▶' : r.position;
      const actions = r.active
        ? ''
        : `<button class="btn btn-mini" data-action="cancel" data-id="${r.id}">Batal</button>`;
      const retry =
        r.status === 'failed'
          ? `<button class="btn btn-mini" data-action="retry" data-id="${r.id}">Ulangi</button>`
          : '';
      return `<tr>
        <td class="muted">${pos}</td>
        <td><strong>${escapeHtml(r.roblox_username)}</strong></td>
        <td class="muted">${escapeHtml(r.tiktok_user ?? '—')}</td>
        <td>${tagFor(r.package)}</td>
        <td class="status-${r.status}">${r.status}</td>
        <td>${retry} ${actions}</td>
      </tr>`;
    })
    .join('');
}

function renderPending(pending = []) {
  const list = $('pending-list');
  if (!pending.length) {
    list.innerHTML = '<li class="muted small">Tidak ada pembayaran menunggu.</li>';
    return;
  }
  list.innerHTML = pending
    .map(
      (r) => `<li>
        <div class="row">
          <div>
            <strong>${escapeHtml(r.roblox_username)}</strong>
            <span class="muted small"> · ${escapeHtml(r.tiktok_user ?? 'tanpa tiktok')} · ${r.package}</span>
          </div>
          <span class="badge">${r.payment_status}</span>
        </div>
        <div class="row gap" style="margin-top: 8px">
          <button class="btn btn-mini" data-pay="approve" data-id="${r.id}">Setujui</button>
          <button class="btn btn-mini btn-danger" data-pay="reject" data-id="${r.id}">Tolak</button>
          <span class="muted small">${escapeHtml(r.note ?? '')}</span>
        </div>
      </li>`,
    )
    .join('');
}

function renderReview(review) {
  if (!review) return;
  $('preview-username').textContent = review.username ?? '—';
  $('preview-display').textContent = review.displayName ? `Display name: ${review.displayName}` : '';
  $('preview-score').textContent = review.score ?? '–';
  $('preview-verdict').textContent = review.verdict ?? '—';
  $('preview-source').textContent = review.narrationSource ?? '—';
  if (review.avatarUrl || review.headshotUrl) {
    const img = $('preview-avatar');
    img.src = review.headshotUrl || review.avatarUrl;
    img.alt = review.username ?? '';
  }
  const stats = review.stats ?? {};
  $('preview-stats').innerHTML = [
    ['Item outfit', fmt(stats.outfitItems)],
    ['Nilai outfit', stats.outfitValue ?? 'Unavailable'],
    ['Limited', stats.limitedCount == null ? 'Unavailable' : fmt(stats.limitedCount)],
    ['Follower', stats.followers ?? 'Unavailable'],
  ]
    .map(([label, value]) => `<div class="tile"><span>${label}</span><b>${escapeHtml(String(value))}</b></div>`)
    .join('');
  const narration = $('preview-narration');
  narration.textContent = review.narrationText ?? 'Naskah belum tersedia.';
  narration.classList.toggle('muted', !review.narrationText);
  $('preview-note').textContent = review.notes?.length ? review.notes.join(' ') : '';
}

function renderSpeech(speech) {
  if (!speech) return;
  const el = $('speech-state');
  el.textContent = speech.playing ? 'memutar' : paused ? 'dijeda' : muted ? 'mute' : 'idle';
  const parts = [];
  if (speech.current) parts.push(`sekarang: ${speech.current.username} (request #${speech.current.requestId})`);
  if (speech.pending) parts.push(`${speech.pending} audio menunggu`);
  if (speech.lastError) parts.push(`error: ${speech.lastError}`);
  $('speech-detail').textContent = parts.length ? parts.join(' · ') : 'Tidak ada audio yang diputar.';
  $('btn-pause').textContent = paused ? 'Resume antrean' : 'Pause antrean';
  $('btn-mute').textContent = muted ? 'Unmute' : 'Mute';
}

function renderStats(stats) {
  if (!stats) return;
  const tiles = [
    ['Total request', fmt(stats.total_requests)],
    ['Selesai', fmt(stats.completed)],
    ['Gift', fmt(stats.gifts)],
    ['Pendapatan', `Rp${fmt(stats.revenue_idr)}`],
  ];
  $('stats-grid').innerHTML = tiles
    .map(([label, value]) => `<div class="tile"><span>${label}</span><b>${value}</b></div>`)
    .join('');
}

function renderLogs(logs = []) {
  $('log-list').innerHTML = logs
    .slice(-40)
    .reverse()
    .map((entry) => {
      const time = entry.time.slice(11, 19);
      return `<li class="${entry.level}">${time} ${escapeHtml(entry.message)}</li>`;
    })
    .join('');
}

function fillSettings(next) {
  settings = next;
  if (!next) return;
  $('mode-select').value = next.tiktok.mode;
  if ($('live-username').value === 'demo' && next.tiktok.username) $('live-username').value = next.tiktok.username;
  $('set-voice').value = next.tts.voice;
  $('set-alt-voice').value = next.tts.altVoice;
  $('set-device').value = next.audio.device ?? '';
  $('set-ai').checked = !!next.ai.enabled;
  $('set-ai-model').value = next.ai.model ?? '';
}

function fillVoiceOptions() {
  const options = voices.map((v) => `<option value="${v}">${v}</option>`).join('');
  $('set-voice').innerHTML = options;
  $('set-alt-voice').innerHTML = options;
}

let packageSignature = '';
function fillPackages(packages) {
  const signature = packages.map((p) => p.id).join(',');
  if (signature === packageSignature) return; // jangan reset pilihan user tiap polling
  packageSignature = signature;
  $('manual-package').innerHTML = packages
    .map((p) => `<option value="${p.id}">${p.label}${p.priceIdr ? ` · Rp${fmt(p.priceIdr)}` : ''}</option>`)
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

async function loadState() {
  const state = await api('/api/state');
  paused = !!state.speech?.paused;
  muted = !!state.speech?.muted;
  renderTikTok(state.tiktok);
  renderReview(state.review);
  renderSpeech(state.speech);
  renderStats(state.stats);
  renderLogs(state.logs);
  fillSettings(state.settings);
}

async function loadQueue() {
  const data = await api('/api/queue');
  renderQueue(data.waiting, data.active);
  renderPending(data.pendingPayment);
  fillPackages(data.packages);
}

function connectSse() {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => {
    const state = JSON.parse(event.data);
    renderQueue(state.queue ?? [], []);
    renderReview(state.review);
    renderSpeech(state.speech);
    renderTikTok(state.tiktok);
    paused = !!state.speech?.paused;
    muted = !!state.speech?.muted;
  });
  events.addEventListener('task', (event) => {
    const task = JSON.parse(event.data);
    if (task.status === 'failed' && task.error) toast(task.error, 'error');
  });
  events.addEventListener('alert', (event) => {
    const alert = JSON.parse(event.data);
    const now = Date.now();
    if (now - lastAlertAt < 3000) return; // hindari toast beruntun
    lastAlertAt = now;
    toast(alert.message, alert.kind === 'error' ? 'error' : 'info');
  });
  events.addEventListener('error', () => {
    // EventSource otomatis reconnect
  });
}

$('btn-start-live').addEventListener('click', async () => {
  try {
    const mode = $('mode-select').value;
    const username = $('live-username').value.trim() || 'demo';
    const out = await api('/api/tiktok/start', { method: 'POST', body: { mode, username } });
    toast(out.message ?? 'Listener dimulai');
    await loadState();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-stop-live').addEventListener('click', async () => {
  try {
    await api('/api/tiktok/stop', { method: 'POST', body: {} });
    toast('Listener dihentikan');
    await loadState();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-emergency').addEventListener('click', async () => {
  if (!confirm('Hentikan semua audio dan kembalikan antrean audio ke waiting?')) return;
  try {
    const out = await api('/api/audio/stop', { method: 'POST', body: {} });
    toast(`Emergency stop: ${out.cancelledAudio} audio dibatalkan, ${out.waiting} request menunggu`);
    await loadQueue();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-skip').addEventListener('click', async () => {
  try {
    const out = await api('/api/audio/skip', { method: 'POST', body: {} });
    toast(out.skipped ? 'Review dilewati' : 'Tidak ada audio yang diputar');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-pause').addEventListener('click', async () => {
  try {
    const out = await api(paused ? '/api/audio/resume' : '/api/audio/pause', { method: 'POST', body: {} });
    paused = !!out.state?.paused;
    renderSpeech(out.state);
    toast(paused ? 'Antrean audio dijeda' : 'Antrean audio dilanjutkan');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-mute').addEventListener('click', async () => {
  try {
    const out = await api('/api/audio/mute', { method: 'POST', body: { muted: !muted } });
    muted = !!out.state?.muted;
    renderSpeech(out.state);
    toast(muted ? 'Audio di-mute (review tetap ditandai selesai)' : 'Audio aktif kembali');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('queue-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    await api(`/api/queue/${id}/${action}`, { method: 'POST', body: {} });
    await loadQueue();
    toast(action === 'retry' ? 'Request diulang' : 'Request dibatalkan');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('pending-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-pay]');
  if (!button) return;
  const { pay, id } = button.dataset;
  try {
    await api(`/api/payments/${id}/${pay}`, { method: 'POST', body: {} });
    await loadQueue();
    toast(pay === 'approve' ? 'Pembayaran diverifikasi' : 'Pembayaran ditolak');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('manual-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const out = await api('/api/queue', {
      method: 'POST',
      body: {
        username: $('manual-username').value.trim(),
        packageId: $('manual-package').value,
        txnCode: $('manual-txn').value.trim() || null,
      },
    });
    $('manual-username').value = '';
    $('manual-txn').value = '';
    toast(out.message);
    await loadQueue();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const out = await api('/api/settings', {
      method: 'PATCH',
      body: {
        tts: { voice: $('set-voice').value, altVoice: $('set-alt-voice').value },
        audio: { device: $('set-device').value.trim() },
        ai: { enabled: $('set-ai').checked, model: $('set-ai-model').value.trim() || 'qwen3.5:9b' },
      },
    });
    settings = out.settings;
    toast('Settings disimpan');
  } catch (err) {
    toast(err.message, 'error');
  }
});

(async function init() {
  try {
    const cfg = await api('/api/settings');
    voices = cfg.voices ?? [];
    fillVoiceOptions();
    fillSettings(cfg.settings);
    await loadQueue();
    await loadState();
    connectSse();
    setInterval(() => loadQueue().catch(() => {}), 3000);
    setInterval(() => loadState().catch(() => {}), 10000);
  } catch (err) {
    toast(`Gagal memuat dashboard: ${err.message}`, 'error');
  }
})();
