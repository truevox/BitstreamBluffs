/*
 * Page-side HUD layout scenarios for `node tools/sim/shots.mjs hud <outDir> [{"only":["name"]}]` (plain script, loaded after
 * shots-page.js). Boots a real RunScene + UIScene, freezes RunScene (so it stops emitting score / speed events) and then drives the
 * HUD only through its public events on game.events with the payload shapes from src/events.js, several in the same frame.
 * Each scenario awaits window.__shot(name, meta) at chosen frames; meta carries the number of overlapping text pairs found by
 * the in-page overlap probe (bounding boxes of every visible HUD text, scaled, pairwise intersection).
 */
(() => {
  'use strict';
  const S = () => window.__shots;

  /** Visible HUD texts with their screen-space boxes (game px, 480x270). */
  function textBoxes(ui) {
    const out = [];
    const walk = (list, ox, oy, sx, sy, alpha) => {
      for (const c of list) {
        if (!c.visible) continue;
        const a = alpha * (c.alpha === undefined ? 1 : c.alpha);
        if (c.main && c.main.text !== undefined) {
          const txt = c.main.text;
          if (!txt || a < 0.08) continue;
          const s = c.scaleX * sx;
          const w = c.main.width * s; const h = 8 * s;
          const ox2 = c.main.originX; const oy2 = c.main.originY;
          const x = ox + c.x * sx - w * ox2; const y = oy + c.y * sy - c.main.height * s * oy2;
          out.push({ text: txt, x, y, w, h });
        } else if (c.list) walk(c.list, ox + c.x * sx, oy + c.y * sy, sx * c.scaleX, sy * c.scaleY, a);
      }
    };
    walk(ui.hud.list, ui.hud.x, ui.hud.y, 1, 1, 1);
    return out;
  }
  function overlaps(ui) {
    const b = textBoxes(ui); const hits = [];
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const p = b[i]; const q = b[j];
        const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        if (ix > 1 && iy > 1) hits.push([p.text, q.text, Math.round(ix), Math.round(iy)]);
      }
    }
    return hits;
  }

  async function run(o) {
    const only = o.only || null;
    const env = await S().boot('sim-01');
    const { EVT, REG } = env.M; const game = env.game;
    for (let f = 0; f < 60; f++) S().frame(env, false);
    game.scene.pause('RunScene');
    const ui = game.scene.getScene('UIScene');
    const emit = (name, p) => game.events.emit(EVT[name], p);
    const step = (n) => { for (let i = 0; i < n; i++) S().frame(env, false); };
    const results = [];
    const shot = async (name, extra) => {
      S().frame(env, true);
      const hits = overlaps(ui);
      results.push({ name, hits });
      await window.__shot(name, { overlaps: hits, ...extra });
    };
    const reset = () => {
      emit('RUN_START', { runId: 'r', seed: 'sim-01', dailyRuleId: 'featherweight', startedAt: 0 });
      ui.stripQueue.length = 0;
      step(200);
      ui.hud.list.forEach(() => {});
    };
    const base = (w) => {
      emit('SCORE_CHANGED', { total: w.score || 12345, delta: 0, bankedPoints: 0 });
      emit('DISTANCE_CHANGED', { meters: w.meters || 2988 });
      game.events.emit('bb:hudSpeed', { speedPxS: w.speed || 760, flow: 1, flowFrac: 0 });
    };
    const want = (n) => !only || only.includes(n);

    // 1. perfect landing + boost in the same frame
    if (want('landing-boost')) {
      reset(); base({});
      emit('LANDING', { quality: 'perfect', angleDeg: 2, impactSpeedPxS: 300, airtimeMs: 900, bonusPoints: 20, bankedPoints: 0, hard: false, x: 0, y: 0, comboName: '', comboMult: 1, flowUsed: 1 });
      emit('LANDING_BOOST', { amountPxS: 28, quality: 'perfect', comboMult: 1, tricks: 0 });
      step(2); await shot('landing-boost-pop');
      step(8); await shot('landing-boost');
      step(30); await shot('landing-boost-later');
    }
    // 2. landing + long combo name + flow change + tricks + near miss
    if (want('landing-combo-flow')) {
      reset(); base({ score: 456789, meters: 12480, speed: 1700 });
      emit('TRICK', { type: 'backflip', value: 150, isNew: true, count: 2 });
      emit('TRICK', { type: 'helicopterCW', value: 300, isNew: false, count: 1 });
      emit('COMBO_CHANGED', { multiplier: 2.75, tricks: ['a', 'b', 'c'], pendingPoints: 4200 });
      emit('FLOW_CHANGED', { flow: 2.5, previous: 2, reason: 'gain', timeoutFrac: 1, best: 2.5 });
      emit('LANDING', { quality: 'perfect', angleDeg: 1, impactSpeedPxS: 300, airtimeMs: 1800, bonusPoints: 20, bankedPoints: 123456, hard: false, x: 0, y: 0, comboName: 'DOUBLE BACKFLIP + HELI + FRONTFLIP', comboMult: 2.75, flowUsed: 2.5 });
      emit('LANDING_BOOST', { amountPxS: 128, quality: 'perfect', comboMult: 2.75, tricks: 3 });
      emit('NEAR_MISS', { hazardType: 'rock', points: 25, x: 0, y: 0 });
      step(12); await shot('landing-combo-flow');
      step(40); await shot('landing-combo-flow-later');
    }
    // 3. milestone + new best + near miss (+ a good landing)
    if (want('milestone-best-miss')) {
      reset(); base({ score: 98765, meters: 6000 });
      emit('MILESTONE', { sector: 12, distanceM: 6000, points: 1500 });
      emit('NEW_BEST', { distanceM: 6000, previousBestM: 5400 });
      emit('NEAR_MISS', { hazardType: 'rock', points: 25, x: 0, y: 0 });
      emit('NEAR_MISS', { hazardType: 'rock', points: 25, x: 0, y: 0 });
      emit('LANDING', { quality: 'good', angleDeg: 6, impactSpeedPxS: 300, airtimeMs: 900, bonusPoints: 0, bankedPoints: 640, hard: false, x: 0, y: 0, comboName: 'BACKFLIP', comboMult: 1.5, flowUsed: 1 });
      emit('LANDING_BOOST', { amountPxS: 12, quality: 'good', comboMult: 1.5, tricks: 1 });
      emit('FLOW_CHANGED', { flow: 1.5, previous: 1, reason: 'gain', timeoutFrac: 1, best: 1.5 });
      step(14); await shot('milestone-best-miss');
      step(52); await shot('milestone-best-miss-2');
    }
    // 3b. the reported speed / shards collision: a boost pops the speed readout while the shard counter is showing
    if (want('speed-shards-pop')) {
      reset(); base({ score: 5273, meters: 2988, speed: 830 });
      emit('SHARD_COLLECTED', { chain: 3, points: 10, total: 130, count: 13, x: 0, y: 0 });
      emit('LANDING_BOOST', { amountPxS: 28, quality: 'perfect', comboMult: 1, tricks: 0 });
      step(2); await shot('speed-shards-pop');
    }
    // 4. widest fixed rows
    if (want('max-width')) {
      reset();
      base({ score: 9999999, meters: 99999, speed: 2400 });
      for (let i = 0; i < 3; i++) emit('SHARD_COLLECTED', { chain: 25, points: 10, total: 9990, count: 9999, x: 0, y: 0 });
      emit('COMBO_CHANGED', { multiplier: 10, tricks: new Array(12).fill('t'), pendingPoints: 99999 });
      emit('FLOW_CHANGED', { flow: 3, previous: 2.5, reason: 'gain', timeoutFrac: 1, best: 3 });
      emit('ZONE_ENTER', { modId: 'wirelessBridge' });
      emit('HAZARD_HIT', { effect: 'scramble', durationMs: 5000 });
      emit('HAZARD_HIT', { effect: 'slow', durationMs: 5000 });
      for (const id of ['clockPulse', 'packetBurst', 'hashedBackup']) emit('POWERUP_COLLECTED', { id, durationMs: 9000 });
      emit('LANDING_BOOST', { amountPxS: 1234, quality: 'perfect', comboMult: 10, tricks: 3 });
      step(3); await shot('max-width-boost-pop');
      step(40); await shot('max-width');
    }
    // 5. tutorial hint box together with banners (keyboard, gamepad widest label)
    if (want('hint-banners')) {
      reset(); base({ score: 50210, meters: 3400 });
      for (const id of ['clockPulse', 'packetBurst', 'hashedBackup']) emit('POWERUP_COLLECTED', { id, durationMs: 9000 });
      emit('TUTORIAL_HINT', { id: 'flip', show: true });
      emit('LANDING', { quality: 'perfect', angleDeg: 1, impactSpeedPxS: 300, airtimeMs: 900, bonusPoints: 20, bankedPoints: 900, hard: false, x: 0, y: 0, comboName: 'DOUBLE BACKFLIP', comboMult: 2, flowUsed: 1 });
      emit('LANDING_BOOST', { amountPxS: 90, quality: 'perfect', comboMult: 2, tricks: 2 });
      emit('MILESTONE', { sector: 3, distanceM: 1500, points: 500 });
      for (let i = 0; i < 3; i++) emit('NEAR_MISS', { hazardType: 'rock', points: 25, x: 0, y: 0 });
      step(12); await shot('hint-banners-keyboard');
      ui.hintId = null; emit('TUTORIAL_HINT', { id: 'flip', show: false });
      const router = game.registry.get(REG.INPUT);
      router.pad.state.lastSource = 'gamepad';
      emit('TUTORIAL_HINT', { id: 'flip', show: true });
      step(4); await shot('hint-banners-gamepad');
      router.pad.state.lastSource = 'keyboard';
    }
    // 6. touch controls layout (overlay forced on)
    if (want('touch')) {
      reset(); base({ score: 50210, meters: 3400 });
      const router = game.registry.get(REG.INPUT);
      const ov = router && router.pad && router.pad.overlay;
      if (ov) { ov.mode = 'on'; ov.setContextVisible(true); }
      for (const id of ['clockPulse', 'packetBurst', 'hashedBackup']) emit('POWERUP_COLLECTED', { id, durationMs: 9000 });
      emit('TUTORIAL_HINT', { id: 'flip', show: true });
      emit('LANDING', { quality: 'perfect', angleDeg: 1, impactSpeedPxS: 300, airtimeMs: 900, bonusPoints: 20, bankedPoints: 900, hard: false, x: 0, y: 0, comboName: 'DOUBLE BACKFLIP', comboMult: 2, flowUsed: 1 });
      emit('LANDING_BOOST', { amountPxS: 90, quality: 'perfect', comboMult: 2, tricks: 2 });
      emit('ZONE_ENTER', { modId: 'wirelessBridge' });
      step(12); await shot('touch', { overlayVisible: !!(ov && ov.isVisible()) });
      if (ov) { ov.mode = 'off'; ov._refresh(); }
    }
    return results;
  }
  window.__shotsHud = { run, overlaps };
})();
