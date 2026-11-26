// Write-only collector; no credentials, no fingerprints. Random browser and page-session IDs only.
export const DRIVE_COLLECTOR = 'https://script.google.com/macros/s/AKfycbzjTVdaWFYiZcxKU9n3YgynZp4qTARbtBkfqY1tECQU0NUgq_1JbSQj0dJwhfcxKhOJag/exec';
export const QUEUE_KEY = 'bb.playtest.upload.v1';
export const PLAYER_KEY = 'bb.playtest.player.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only called after telemetry is enabled. No fallback to fingerprinting,
// accounts, or IPs if browser storage is unavailable.
function browserPlayer(win) {
  try {
    const existing = win.localStorage.getItem(PLAYER_KEY);
    if (UUID.test(existing || '')) return existing;
    const created = win.crypto.randomUUID();
    if (!UUID.test(created)) return null;
    win.localStorage.setItem(PLAYER_KEY, created);
    const stored = win.localStorage.getItem(PLAYER_KEY);
    return UUID.test(stored || '') ? stored : null;
  } catch { return null; }
}

export function createPlaytestUpload(win, version, endpoint = DRIVE_COLLECTOR) {
  const session = win.crypto.randomUUID();
  const player = browserPlayer(win);
  let batch = 0, staged = [], stagedSize = 0, queue = [], busy = false, stopped = false, dropped = 0;
  try {
    const saved = JSON.parse(win.sessionStorage.getItem(QUEUE_KEY) || '[]');
    if (Array.isArray(saved)) queue = saved.filter(x => typeof x === 'string' && x.length <= 48000).slice(-20);
  } catch {}
  const save = () => { try { win.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {} };
  function seal() {
    if (!staged.length) return;
    const body = JSON.stringify({schema:1, version, session, ...(player ? {player} : {}), batch:batch++, events:staged, dropped});
    staged = []; stagedSize = 0;
    if (queue.length >= 20) { queue.shift(); dropped++; }
    queue.push(body);
    save();
  }
  function add(event) {
    if (stopped) return;
    const size = JSON.stringify(event).length + 1;
    if (staged.length >= 100 || stagedSize + size > 45000) seal();
    staged.push(event); stagedSize += size;
  }
  async function flush(keepalive = false) {
    if (stopped) return;
    seal();
    if (busy || !queue.length) return;
    busy = true;
    try {
      // Drain backlog on a live page, one bounded request at a time.
      for (let i = 0; i < (keepalive ? 1 : 10) && queue.length && !stopped; i++) {
      const body = queue[0];
      const response = await win.fetch(endpoint, {
        method:'POST', body, headers:{'Content-Type':'text/plain;charset=UTF-8'},
        credentials:'omit', cache:'no-store', redirect:'follow', keepalive,
      });
      if (response.ok && (await response.json()).ok === true && !stopped) {
        if (queue[0] === body) queue.shift();
        save();
      } else break;
      }
    } catch { /* retain the identical batch for retry/deduplication */ }
    finally { busy = false; }
  }
  return {add, flush, stop() {
    stopped = true; staged = []; stagedSize = 0; queue = [];
    try { win.sessionStorage.removeItem(QUEUE_KEY); } catch {}
  }, status() { return {queued:queue.length, staged:staged.length, droppedBatches:dropped}; }};
}
