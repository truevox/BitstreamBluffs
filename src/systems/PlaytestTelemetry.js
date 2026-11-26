// Temporary production playtest recorder. No account IDs or device fingerprints.
import { EVT } from '../events.js';
import { createPlaytestUpload, QUEUE_KEY } from './PlaytestUpload.js';

const fields = {
  [EVT.RUN_START]: 'dailyOfficial dailyMode gym practice takeover',
  [EVT.RUN_ABORT]: 'reason practice takeover cause',
  [EVT.CRASH]: 'cause x y speedPxS hazardId negated fatal',
  [EVT.LANDING]: 'quality angleDeg impactSpeedPxS airtimeMs bonusPoints bankedPoints hard x y comboMult flowUsed midSpin',
  [EVT.TRICK]: 'type count value isNew airtimeMs',
  [EVT.COMBO_CHANGED]: 'multiplier pendingPoints reason',
  [EVT.POWERUP_COLLECTED]: 'id durationMs charges',
  [EVT.POWERUP_EXPIRED]: 'id reason',
  [EVT.HAZARD_HIT]: 'hazardId effect durationMs x y',
  [EVT.RESPAWN]: 'reason x y comboPenalty',
  [EVT.BIOME_ENTER]: 'id sector entering',
  [EVT.GAME_PAUSE]: 'runTimeMs reason',
  [EVT.GAME_RESUME]: 'runTimeMs reason',
  [EVT.NEAR_MISS]: 'hazardType points x y',
  [EVT.BSOD_BLUFF]: 'chain surfing closestGapPx canopyRecoveredMs',
  [EVT.FLOW_CHANGED]: 'flow previous reason best',
  [EVT.FLOW_LOST]: 'previous reason',
  [EVT.TUTORIAL_HINT]: 'id show',
  [EVT.MILESTONE]: 'sector distanceM points',
  [EVT.MISSION_COMPLETED]: 'id xp shards',
  [EVT.INPUT_ACTION]: 'action pressed source',
  [EVT.GYM_ATTEMPT_RESET]: 'attempt readyMs',
  [EVT.GYM_READY_GO]: 'onBeat',
  [EVT.LANDING_BOOST]: 'amountPxS quality comboMult tricks',
};
const resultFields = 'durationMs score distanceM trickPoints bestCombo bestFlow maxAirtimeMs shards nearMisses bonusPoints dailyOfficial modded';
const samples = {
  [EVT.DISTANCE_CHANGED]: 'meters',
  [EVT.SCORE_CHANGED]: 'total distancePoints trickPoints',
  [EVT.BSOD_STATE_CHANGED]: 'active gapPx wallSpeedPxS sledVelocityXPxS proximity01 timeToImpactMs',
  'bb:hudSpeed': 'speedPxS flow',
};
const actions = new Set(['hop','reset','pause','confirm','cancel','up','down','left','right','airBrake','parachute','push','tuck','frontflip','backflip','helicopterCW','helicopterCCW']);
const pick = (data, keys) => {
  const out = {};
  for (const k of keys.split(' ')) {
    const v = data?.[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ||
        (typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v))) out[k] = v;
  }
  return out;
};

export function createPlaytestRecorder({version, now = () => performance.now(), limit = 12000, onEvent = () => {}} = {}) {
  let start = null, events = [], dropped = 0, run = 0, active = false, sample = {};
  const add = (type, data = {}) => {
    if (start === null) return;
    const event = {ms: Math.max(0, Math.round(now() - start)), run, type, data};
    try { onEvent(event); } catch {}
    if (events.length >= limit) { dropped++; return; }
    events.push(event);
  };
  return {
    get recording() { return start !== null; },
    start() { if (start === null) { start = now(); add('recording_start'); } },
    event(type, payload) {
      if (start === null) return;
      if (type === EVT.INPUT_ACTION && !actions.has(payload?.action)) return;
      if (type === EVT.RUN_START) { run++; active = true; sample = {}; }
      if (type === EVT.RUN_END) {
        if (active) add('run_end', pick(payload?.record, resultFields));
        active = false; return;
      }
      if (Object.hasOwn(samples, type)) {
        if (active) sample[type] = pick(payload, samples[type]);
        return;
      }
      if (Object.hasOwn(fields, type) && (active || type === EVT.INPUT_ACTION)) {
        add(type.slice(3), pick(payload, fields[type]));
      }
      if (type === EVT.RUN_ABORT) active = false;
    },
    tick(fps) { if (active) add('sample', {...sample, ...(Number.isFinite(fps) ? {fps: Math.round(fps)} : {})}); },
    error(kind) { if (kind === 'error' || kind === 'unhandledrejection') add(kind); },
    snapshot() { return {schema: 1, version, dropped, events: events.slice()}; },
    clear() { start = null; events = []; dropped = 0; run = 0; active = false; sample = {}; },
  };
}

const storageKey = 'bb.playtest.telemetry.v1';
const optOutKey = 'bb.playtest.disabled.v1';
// Temporary owner-authorized pre-alpha collection. Remove before public launch.
const DEFAULT_PLAYTEST_HOST = 'simulate.sledhead.ing';

// Default on at the production playtest host only; no in-game overlay.
export function installPlaytestTelemetry(game, version, win = window) {
  const mode = new URLSearchParams(win.location.search).get('playtest');
  const erasePending = () => {
    try { win.sessionStorage.removeItem(storageKey); win.sessionStorage.removeItem(QUEUE_KEY); } catch {}
  };
  if (mode === '0') {
    try { win.localStorage.setItem(optOutKey, '1'); } catch {}
    erasePending();
    return;
  }
  let disabled = false;
  try { disabled = win.localStorage.getItem(optOutKey) === '1'; } catch {}
  if (disabled) { erasePending(); return; }
  if (mode !== '1' && mode !== 'export' && win.location.hostname !== DEFAULT_PLAYTEST_HOST) return;
  const doc = win.document;
  const download = data => {
    if (!data) return;
    const url = win.URL.createObjectURL(new win.Blob([data], {type:'application/json'}));
    const a = doc.createElement('a'); a.href = url; a.download = 'bsb-playtest.json'; a.click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  };
  if (mode === 'export') {
    try { download(win.sessionStorage.getItem(storageKey)); } catch {}
    return;
  }
  let upload;
  try { upload = createPlaytestUpload(win, version); } catch {}
  const recorder = createPlaytestRecorder({version, onEvent: event => upload?.add(event)});
  recorder.start();
  // Keep previous reload segments, within a strict total bound. Never merge raw save data.
  let previous = [];
  try {
    const saved = JSON.parse(win.sessionStorage.getItem(storageKey) || 'null');
    if (saved?.schema === 1 && Array.isArray(saved.segments)) previous = saved.segments.slice(-2);
  } catch {}
  const serialize = () => JSON.stringify({schema:1, segments:[...previous, recorder.snapshot()]});
  const persist = () => { try { win.sessionStorage.setItem(storageKey, serialize()); } catch {} };
  const stop = () => {
    upload?.stop(); recorder.clear(); previous = [];
    try { win.localStorage.setItem(optOutKey, '1'); } catch {}
    erasePending();
  };
  const onStorage = e => { if (e.key === optOutKey && e.newValue === '1') stop(); };
  win.addEventListener('storage', onStorage);
  // Developer access from the console, not an in-game control.
  win.__bbPlaytest = {
    export: () => download(serialize()),
    snapshot: () => JSON.parse(serialize()),
    uploadStatus: () => upload?.status(),
    flush: () => upload?.flush(),
    stop,
  };
  const listeners = [...Object.keys(fields), ...Object.keys(samples), EVT.RUN_END].map(type => {
    const fn = payload => { try { recorder.event(type, payload); if (recorder.recording && (type === EVT.RUN_END || type === EVT.RUN_ABORT)) persist(); } catch {} };
    game.events.on(type, fn); return [type, fn];
  });
  const timer = win.setInterval(() => { if (!doc.hidden && recorder.recording) recorder.tick(game.loop?.actualFps); }, 1000);
  const saveTimer = win.setInterval(() => { if (recorder.recording) persist(); }, 5000);
  const uploadTimer = win.setInterval(() => { if (recorder.recording) void upload?.flush(); }, 30000);
  const onHide = () => { if (recorder.recording) { persist(); void upload?.flush(true); } };
  const onError = e => recorder.error(e.type);
  const onVisibility = () => { if (doc.hidden) onHide(); };
  win.addEventListener('pagehide', onHide);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('error', onError); win.addEventListener('unhandledrejection', onError);
  game.events.once('destroy', () => {
    onHide();
    for (const [type, fn] of listeners) game.events.off(type, fn);
    win.clearInterval(timer); win.clearInterval(saveTimer); win.clearInterval(uploadTimer);
    win.removeEventListener('pagehide', onHide); doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('error', onError); win.removeEventListener('unhandledrejection', onError);
    win.removeEventListener('storage', onStorage);
    delete win.__bbPlaytest;
  });
}
