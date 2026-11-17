// Satu tempat untuk menyiarkan keadaan ke dashboard & overlay (SSE).
// Overlay membaca snapshot ini, jadi tidak perlu polling.

const clients = new Set();

const state = {
  tiktok: { status: 'idle', username: null, mode: null, message: null, stats: null },
  task: { status: 'idle' },
  queue: [],
  speech: { playing: false, paused: false, muted: false, current: null, pending: 0 },
  alert: null,
  updatedAt: null,
};

function send(client, type, data) {
  try {
    client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

export function subscribeSse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res };
  clients.add(client);
  send(client, 'state', getOverlayState());

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

export function emit(type, data) {
  for (const client of clients) send(client, type, data);
}

export function updateState(patch) {
  // Speech queue memanggil ini tiap tick; jangan menyiarkan state yang tidak berubah
  // supaya dashboard/overlay tidak berkedip.
  const before = JSON.stringify(state);
  Object.assign(state, patch);
  if (JSON.stringify(state) === before) return;
  state.updatedAt = new Date().toISOString();
  emit('state', getOverlayState());
}

export function updateTask(task) {
  state.task = { ...state.task, ...task };
  state.updatedAt = new Date().toISOString();
  emit('task', state.task);
  emit('state', getOverlayState());
}

export function setAlert(alert) {
  state.alert = { ...alert, at: new Date().toISOString() };
  emit('alert', state.alert);
  emit('state', getOverlayState());
}

export function getOverlayState() {
  return { ...state, updatedAt: state.updatedAt };
}

export function clientCount() {
  return clients.size;
}
