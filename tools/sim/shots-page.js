/*
 * Page-side scenarios for tools/sim/shots.mjs (loaded with page.addInitScript after browser.js). Plain script.
 * Boots a real RunScene (+ UIScene) with a scripted pad, steps it at a fixed 1/60 s with Phaser's real render on the
 * frames that are screenshotted, and awaits window.__shot(name, meta) (exposed by shots.mjs) at interesting moments.
 */
(() => {
  'use strict';
  const DT = 1000 / 60;
  let mods = null;
  async function loadMods() {
    if (mods) return mods;
    const [ev, con, tun] = await Promise.all([import('/src/events.js'), import('/src/constants.js'), import('/src/systems/PhysicsTuner.js')]);
    mods = { EVT: ev.EVT, REG: con.REG, PPM: con.PIXELS_PER_METER, TUNING: tun.TUNING, W: con.GAME_WIDTH, H: con.GAME_HEIGHT };
    return mods;
  }
  const newPad = () => ({
    push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: false, pause: false,
    lastSource: 'keyboard', pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
  });

  async function boot(seed) {
    const M = await loadMods();
    const { EVT, REG } = M;
    const game = window.__bbGame;
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    const audio = game.registry.get(REG.AUDIO);
    if (audio) for (const k of ['playSfx', 'glitch', 'setSpeed', 'setIntensity', 'startMusic', 'stopMusic', 'duckMusic', 'unlock']) audio[k] = () => {};
    game.registry.set(REG.AUDIO, null);
    const store = game.registry.get(REG.SAVE_STORE);
    if (store && Array.isArray(store.runs)) store.runs.length = 0;
    game.registry.set(REG.SEED, seed);
    const env = { M, game, pad: newPad(), scene: null, t: 0, hints: [] };
    const stub = { poll: () => env.pad, setEnabled() {} };
    game.events.once(EVT.RUN_START, () => {
      env.scene = game.scene.getScene('RunScene');
      env.scene.inputRouter = stub;
      env.scene.dailyMods = {};
      env.scene.dailyRuleId = 'none';
    });
    game.events.on(EVT.TUTORIAL_HINT, (e) => env.hints.push({ ...e, t: env.t }));
    game.scene.start('RunScene');
    let g = 0;
    while (!env.scene && g++ < 5) game.headlessStep(0, DT);
    return env;
  }

  /** advance one frame; render=true uses the full Phaser step so the canvas shows the new frame */
  function frame(env, render) {
    env.t += DT;
    if (render) env.game.step(env.t, DT); else env.game.headlessStep(env.t, DT);
    env.pad.hop = false; env.pad.pressed.hop = false; env.pad.push = false;
  }

  function hopPolicy(env, st) {
    const s = env.scene.sled;
    if (!s.grounded || env.t - st.lastHop < 700) return;
    for (const list of env.scene.hazards.values()) {
      for (const h of list) {
        if (h.hit || h.def.placement === 'air') continue;
        if (h.def.onHit && h.def.onHit.effect !== 'crash') continue;
        const dx = h.cx - s.x; const ms = dx / Math.max(s.vx, 60) * 1000;
        if (dx > 0 && ms <= 380 && ms > 130) { env.pad.hop = true; env.pad.pressed.hop = true; st.lastHop = env.t; return; }
      }
    }
  }

  const hintUi = (env) => { const ui = env.game.scene.getScene('UIScene'); return ui ? { id: ui.hintId, text: ui.hintT && ui.hintT.visible ? ui.hintT.text : null } : null; };

  /** Screenshot every distinct hint the first time it shows (keyboard), driving a hop-policy run. */
  async function hintsNatural(o) {
    const env = await boot(o.seed || 'sim-01');
    const seen = new Set(); const st = { lastHop: -1e9 }; const log = [];
    let pending = null;
    const wantAll = o.ids || ['flip', 'hop', 'boost', 'tuck'];
    for (let f = 0; f < 60 * (o.maxSec || 120); f++) {
      hopPolicy(env, st);
      const n0 = env.hints.length;
      frame(env, false);
      for (const e of env.hints.slice(n0)) if (e.show && !seen.has(e.id)) pending = { id: e.id, at: f + 8 };
      if (pending && f >= pending.at) {
        frame(env, true);
        const ui = hintUi(env);
        await window.__shot(`hint-${pending.id}-keyboard`, { t: env.t / 1000, dist: (env.scene.sled.x - env.scene.startX) / env.M.PPM, ui });
        log.push({ id: pending.id, ui });
        seen.add(pending.id); pending = null;
      }
      if (env.scene.crashed && !env.scene.sled.grounded && false) break;
      if (wantAll.every((i) => seen.has(i))) break;
    }
    return { log, hints: env.hints };
  }

  /** Brake to a stop, wait for the push hint, shoot it, then push and confirm it hides. */
  async function hintPush(o) {
    const env = await boot(o.seed || 'sim-01');
    const out = { phases: [] };
    let stopped = null; let shot = false; let pushedAt = null; let releasedAt = null;
    for (let f = 0; f < 60 * 60; f++) {
      const s = env.scene.sled;
      if (releasedAt != null) { if (env.t - releasedAt > 4000) break; frame(env, false); continue; }
      if (pushedAt == null) env.pad.brake = !(stopped != null);
      if (stopped == null && s.grounded && s.speed < 3) { stopped = env.t; env.pad.brake = false; out.stopAt = env.t / 1000; }
      // keep it stopped (hold the brake) a little so the stall nudge does not hide the evidence; the nudge is the other agent's
      if (stopped != null && pushedAt == null) env.pad.brake = true;
      frame(env, false);
      const shown = env.hints.filter((h) => h.id === 'push' && h.show);
      if (!shot && shown.length) {
        frame(env, true);
        await window.__shot('hint-push-keyboard', { t: env.t / 1000, ui: hintUi(env), speed: s.speed });
        shot = true; out.shownAt = env.t / 1000;
        if (o.release) { releasedAt = env.t; env.pad.brake = false; } else { env.pad.brake = false; env.pad.push = true; pushedAt = env.t; }
      }
      if (pushedAt != null && env.t - pushedAt > 3000) break;
    }
    out.hints = env.hints.filter((h) => h.id === 'push');
    out.sled = { speed: env.scene.sled.speed };
    return out;
  }

  /** Render the label of each hint for touch / gamepad by pushing a hint event through UIScene with that input source. */
  async function hintsModes() {
    const env = await boot('sim-01');
    for (let f = 0; f < 30; f++) frame(env, false);
    const ui = env.game.scene.getScene('UIScene');
    const router = env.game.registry.get(env.M.REG.INPUT);
    const res = [];
    for (const mode of ['touch', 'gamepad']) {
      if (router && router.pad && router.pad.state) router.pad.state.lastSource = mode;
      for (const id of ['push', 'hop', 'flip', 'tuck', 'boost']) {
        ui.onHint({ id, show: true });
        frame(env, true);
        await window.__shot(`hint-${id}-${mode}`, { ui: hintUi(env) });
        ui.onHint({ id, show: false });
        res.push({ mode, id });
      }
    }
    return res;
  }

  /** Debug: the stallProbe sequence (brake to a stop, release, no push) logging the push trigger every 100 ms. */
  async function stallTrace(o) {
    const env = await boot(o.seed || 'sim-01');
    const rows = []; let stopped = null;
    for (let f = 0; f < 60 * 30; f++) {
      const s = env.scene.sled;
      env.pad.brake = stopped == null;
      if (stopped == null && s.grounded && s.speed < 3) stopped = env.t;
      frame(env, false);
      if (stopped != null && f % 6 === 0) rows.push([Math.round(env.t - stopped), Math.round(s.speed), s.grounded ? 1 : 0, Math.round(env.scene.tutTimers.stall), env.scene.hints.currentId, Math.round(env.scene.runTimeMs), s._nudging ? 1 : 0]);
      if (stopped != null && env.t - stopped > 4000) break;
    }
    return { rows, hints: env.hints };
  }

  window.__shots = { stallTrace, hintsNatural, hintPush, hintsModes, boot, frame, hopPolicy, hintUi, loadMods };
})();
