// Cooperative, fail-closed updates. Only an idle title with no storage work
// in progress may consent. Never reload a running/paused game or a menu view.
import { SCENES, REG } from '../constants.js';

export function safeUpdateTitle(game) {
  const sm = game.scene;
  if (!sm?.isActive(SCENES.TITLE)) return null;
  if (sm.isActive(SCENES.RUN) || sm.isPaused?.(SCENES.RUN) ||
      sm.isActive(SCENES.GAME_OVER) || sm.isActive(SCENES.TAKEOVER_END) ||
      sm.isActive(SCENES.PAUSE)) return null;
  const title = sm.getScene(SCENES.TITLE);
  if (!title || title.starting || title.view || !title.input || !title.input_) return null;
  const save = game.registry.get(REG.SAVE_STORE);
  const ghosts = game.registry.get(REG.GHOSTS);
  const attempts = game.registry.get('attemptHistory');
  // Do not discard memory-only saves, or reload while commits are pending.
  if (save?.backend !== 'idb' || save._runWrites?.size ||
      save.runs?.some(r => save.getRunPersistence(r.id) === 'session-only') ||
      ghosts?.backend !== 'idb' || ghosts.pendingWrites ||
      attempts?.kind !== 'idb' || attempts.pendingWrites) return null;
  const active = game.registry.get('activeEvidenceRunId');
  const statuses = game.registry.get('evidenceStatusByRun');
  if (active && !statuses?.has(active)) return null;
  if (statuses && [...statuses.values()].some(s => s.digest && !s.durable)) return null;
  if (game.registry.get('pwaEvidencePending')) return null;
  return title;
}

export function installPwaUpdater(game, registration, win = window) {
  const sw = win.navigator.serviceWorker;
  if (!sw || !registration) return;
  const doc = win.document;
  let dead = false, busy = false, locked = null, readySince = 0, lastCheck = 0;
  let lastAttempt = 0;
  let status = '';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Update now';
  button.hidden = true;
  button.setAttribute('aria-label', 'Update Bitstream Bluffs');
  button.style.cssText = 'position:fixed;z-index:10000;right:10px;top:10px;padding:7px 12px;border:1px solid #00efff;border-radius:4px;background:#111827;color:#fff;font:600 14px system-ui;touch-action:manipulation;cursor:pointer';
  doc.body.appendChild(button);

  function unlock() {
    if (!locked) return;
    const {title, input, menu, starting, timer} = locked;
    locked = null;
    win.clearTimeout(timer);
    title.starting = starting;
    title.input.enabled = input;
    title.input_.enabled = menu;
  }
  function lock(token) {
    const title = safeUpdateTitle(game);
    if (!title || locked) return false;
    const state = {title, token, waiting:registration.waiting, committed:false, input:title.input.enabled, menu:title.input_.enabled, starting:title.starting};
    locked = state;
    title.starting = true;
    title.input.enabled = false;
    title.input_.enabled = false;
    const watchdog = () => {
      if (locked !== state) return;
      if (!state.committed || state.waiting?.state === 'redundant') { unlock(); return; }
      // Never allow a run to start while a consented activation may still
      // arrive. A stalled browser can safely close/reopen the idle title.
      button.textContent = 'Updating… reopen if stuck';
      state.timer = win.setTimeout(watchdog, 15000);
    };
    state.timer = win.setTimeout(watchdog, 15000);
    button.textContent = 'Updating…';
    button.disabled = true;
    return true;
  }
  function onMessage(event) {
    // Only the controlling worker can request a local freeze.
    if (event.source !== sw.controller || !event.data) return;
    const {type, token} = event.data;
    if (type === 'bb:pwa:prepare' && typeof token === 'string' && event.ports?.[0]) {
      const port = event.ports[0];
      // Keep the title frozen until activation or explicit abort.
      port.postMessage({token, ready:lock(token)});
      port.close();
    } else if (type === 'bb:pwa:commit' && locked?.token === token) {
      locked.committed = true;
    } else if (type === 'bb:pwa:abort' && locked?.token === token) {
      unlock();
    }
  }
  function onControllerChange() {
    if (!locked) return; // no surprise reload, including first install
    win.clearTimeout(locked.timer);
    win.location.reload();
  }
  function requestUpdate() {
    if (busy || locked || !registration.waiting || !sw.controller || !safeUpdateTitle(game)) return;
    busy = true;
    lastAttempt = Date.now();
    status = 'Checking other tabs…';
    button.textContent = status;
    const channel = new win.MessageChannel();
    const finish = message => {
      if (!busy) return;
      busy = false;
      win.clearTimeout(timeout);
      channel.port1.close();
      if (!locked) {
        status = message === 'ready' ? 'Updating…' : 'Update now';
        button.title = message === 'blocked' ? 'Finish runs and close menus in other tabs before updating.' : '';
        button.textContent = status;
      }
    };
    const timeout = win.setTimeout(() => finish('timeout'), 12000);
    channel.port1.onmessage = event => finish(event.data?.status);
    try { sw.controller.postMessage({type:'bb:pwa:update'}, [channel.port2]); }
    catch { finish('failed'); }
  }
  function tick() {
    if (dead) return;
    const now = Date.now();
    if (now - lastCheck >= 60000 && !doc.hidden) {
      lastCheck = now;
      Promise.resolve(registration.update()).catch(() => {});
    }
    const ready = !!registration.waiting && !!sw.controller && !!safeUpdateTitle(game);
    if (!ready) readySince = 0;
    else if (!readySince) readySince = now;
    button.hidden = !(ready || locked);
    button.disabled = busy || !!locked;
    if (!busy && !locked) button.textContent = 'Update now';
    // Automatic only after five seconds at the main title, with a retry
    // cooldown so another open gameplay tab never causes a busy loop.
    if (ready && !doc.hidden && now - readySince >= 5000 && now - lastAttempt >= 20000) requestUpdate();
  }
  button.addEventListener('click', requestUpdate);
  // A DOM button must never propagate pointer/key events into game controls.
  for (const type of ['pointerdown','pointerup','keydown','keyup','touchstart','touchend']) button.addEventListener(type, e => e.stopPropagation());
  sw.addEventListener('message', onMessage);
  sw.addEventListener('controllerchange', onControllerChange);
  const interval = win.setInterval(tick, 1000);
  const wake = () => { lastCheck = 0; tick(); };
  win.addEventListener('online', wake);
  doc.addEventListener('visibilitychange', wake);
  game.events.once('destroy', () => {
    dead = true;
    unlock();
    win.clearInterval(interval);
    sw.removeEventListener('message', onMessage);
    sw.removeEventListener('controllerchange', onControllerChange);
    win.removeEventListener('online', wake);
    doc.removeEventListener('visibilitychange', wake);
    button.remove();
  });
  tick();
}
