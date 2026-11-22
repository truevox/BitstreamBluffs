/* Page-side runtime for tools/conformance/cross-engine.mjs (issue #120).
 *
 * DIAGNOSTIC, NON-AUTHORITATIVE. The per-tick digests below are test-side evidence only. They are NOT a replay
 * format and NOT a canonical state hash; they are to be replaced by the #152 contract when it is published.
 *
 * Injected with page.addInitScript, so it is plain browser JS (no imports). It drives the REAL built game
 * (window.__bbGame): RunScene.update is held, the game loop sleeps, and frames are stepped with game.step(t, dt).
 * Only the final GPU rasterisation (renderer.render) is skipped unless raster=true; every JS path (renderFrame,
 * camera, telegraph, SimClock) still runs, so display cadence still reaches the simulation exactly as in play.
 */
(() => {
  // Order = causal order inside RunScene.simTick as far as it matters for "first divergent subsystem".
  // Indices 0-7 are CAUSAL state. 'telegraph' (8) is derived from the camera view (presentation, issue #155) and 'derived' (9) is
  // read-only probe reads of the terrain functions (heightAt/slopeAt at the sled x; atan2 inside): neither is simulation state, and
  // neither counts as a divergence; they are reported in their own columns.
  const SUBSYSTEMS = ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score', 'telegraph', 'derived'];

  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  function hashNums(arr) {
    let h = 0x811c9dc5;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      f64[0] = typeof v === 'number' ? v : (v ? 1 : 0);
      for (let k = 0; k < 2; k++) { h ^= u32[k]; h = Math.imul(h, 0x01000193); }
    }
    return h | 0;
  }


  // ---- Counterfactual: engine-independent replacements for libm-style Math functions (pure IEEE +,-,*,/ and sqrt only, which every
  // engine implements identically). Installed from window.__cePatch BEFORE the game loads. Accuracy is irrelevant here; determinism is.
  // Used only to test "do the engines still diverge when these ops are made identical?" (evidence for #121). Never shipped in the game.
  const PI = 3.141592653589793, TWO_PI = 2 * PI, HALF_PI = PI / 2, LN2 = 0.6931471805599453;
  const detSin = (x) => {
    if (!isFinite(x)) return NaN;
    let k = 0; const q = x / TWO_PI; k = q < 0 ? -Math.floor(-q + 0.5) : Math.floor(q + 0.5);
    let r = x - k * TWO_PI; if (r > PI) r -= TWO_PI; else if (r < -PI) r += TWO_PI;
    const r2 = r * r; let term = r, sum = r;
    for (let i = 1; i <= 14; i++) { term = -term * r2 / ((2 * i) * (2 * i + 1)); sum += term; }
    return sum;
  };
  const detCos = (x) => detSin(x + HALF_PI);
  const detAtan = (z) => {
    if (z !== z) return NaN;
    if (z === Infinity) return HALF_PI; if (z === -Infinity) return -HALF_PI;
    const neg = z < 0; let a = neg ? -z : z; let inv = false;
    if (a > 1) { a = 1 / a; inv = true; }
    for (let i = 0; i < 3; i++) a = a / (1 + Math.sqrt(1 + a * a));
    const a2 = a * a; let term = a, sum = a;
    for (let i = 1; i <= 12; i++) { term = -term * a2; sum += term / (2 * i + 1); }
    sum *= 8; if (inv) sum = HALF_PI - sum;
    return neg ? -sum : sum;
  };
  const detAtan2 = (y, x) => {
    if (x !== x || y !== y) return NaN;
    if (x > 0) return detAtan(y / x);
    if (x < 0) return y >= 0 ? detAtan(y / x) + PI : detAtan(y / x) - PI;
    return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  };
  const detExp = (x) => {
    if (x !== x) return NaN; if (x > 709) return Infinity; if (x < -745) return 0;
    const k = x < 0 ? -Math.floor(-x / LN2 + 0.5) : Math.floor(x / LN2 + 0.5);
    const r = x - k * LN2; let term = 1, sum = 1;
    for (let i = 1; i <= 18; i++) { term = term * r / i; sum += term; }
    let p = 1; const n = k < 0 ? -k : k; for (let i = 0; i < n; i++) p *= 2;
    return k < 0 ? sum / p : sum * p;
  };
  const detLog = (x) => {
    if (x !== x || x < 0) return NaN; if (x === 0) return -Infinity; if (x === Infinity) return Infinity;
    let k = 0, m = x; while (m >= 1.5) { m /= 2; k++; } while (m < 0.75) { m *= 2; k--; }
    const t = (m - 1) / (m + 1), t2 = t * t; let term = t, sum = t;
    for (let i = 1; i <= 24; i++) { term *= t2; sum += term / (2 * i + 1); }
    return 2 * sum + k * LN2;
  };
  const detPow = (x, y) => {
    if (y === 0) return 1; if (x !== x || y !== y) return NaN;
    if (Number.isInteger(y) && Math.abs(y) <= 64) { let r = 1, b = x, e = y < 0 ? -y : y; while (e > 0) { if (e & 1) r *= b; b *= b; e >>= 1; } return y < 0 ? 1 / r : r; }
    if (x <= 0) return NaN;
    return detExp(y * detLog(x));
  };
  const detTanh = (x) => { if (x !== x) return NaN; if (x > 20) return 1; if (x < -20) return -1; const e = detExp(2 * x); return (e - 1) / (e + 1); };
  const detHypot = (...a) => { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s); };
  const DET = { sin: detSin, cos: detCos, tan: (x) => detSin(x) / detCos(x), atan: detAtan, atan2: detAtan2, exp: detExp, log: detLog, pow: detPow, hypot: detHypot,
    tanh: detTanh, sinh: (x) => (detExp(x) - detExp(-x)) / 2, cosh: (x) => (detExp(x) + detExp(-x)) / 2, expm1: (x) => detExp(x) - 1, log1p: (x) => detLog(1 + x),
    log2: (x) => detLog(x) / LN2, log10: (x) => detLog(x) / 2.302585092994046,
    asin: (x) => detAtan2(x, Math.sqrt(1 - x * x)), acos: (x) => detAtan2(Math.sqrt(1 - x * x), x) };
  if (Array.isArray(window.__cePatch)) for (const n of window.__cePatch) if (DET[n]) Math[n] = DET[n];

  const S = (window.__ce = { SUBSYSTEMS, hold: true, current: null, math: null });

  function sampleRaw(run) {
    const b = run.sled.body;
    return [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity];
  }

  function digest(run) {
    const s = run.sled, b = s.body, eng = run.matter.world.engine;
    const out = new Array(SUBSYSTEMS.length);
    const rr = run.runRandom;
    out[0] = hashNums([rr.physics?.state >>> 0, rr.scramble?.state >>> 0, rr.fx?.state >>> 0, rr.sled?.state >>> 0, rr.camera?.state >>> 0]);
    out[1] = hashNums([run.runTimeMs, run.slowmoMs || 0, run.hitStopMs || 0, run.blinkMs || 0, run.simClock.tick]);
    let hz = 0, pu = 0;
    for (const l of run.hazards.values()) hz += l.length;
    for (const l of run.powerups.values()) pu += l.length;
    const al = run.terrain.activeList || [];
    const lastChunk = al.length ? al[al.length - 1] : null;
    out[2] = hashNums([al.length, lastChunk ? lastChunk.endX : 0, lastChunk ? lastChunk.index : 0, hz, pu]);
    out[9] = hashNums([run.terrain.heightAt(s.x), run.slopeAt(s.x)]);
    const kd = [run.kodiakNext || 0, (run.kodiaks || []).length];
    for (const k of run.kodiaks || []) for (const v of Object.values(k)) if (typeof v === 'number' || typeof v === 'boolean') kd.push(v);
    out[3] = hashNums(kd);
    out[4] = hashNums([run.bsod ? run.bsod.wallX : 0, run.bsod ? run.bsod.wallSpeedPxS : 0, run.bsod ? run.bsod.active : 0, run.bsodCaught ? 1 : 0]);
    out[5] = hashNums([b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity, s.grounded, s.parachuteMs || 0, s.parachuteFuelMs || 0,
      s.airtimeMs || 0, s.invulnerableMs || 0, s.heliPhase || 0, s.heliVel || 0, s.tucked, s.airBrakeActive, s.chuteUsed, s.boostMs || 0]);
    const bodies = run.matter.world.localWorld.bodies;
    const w = [bodies.length, eng.timing.timeScale, eng.pairs.list.length];
    for (const q of bodies) w.push(q.position.x, q.position.y, q.angle, q.velocity.x, q.velocity.y);
    out[6] = hashNums(w);
    const sc = [run.score.getTotal?.() ?? 0, run.bestCombo || 0, run.maxAirtimeMs || 0];
    for (const k of Object.keys(run.trickCounts || {}).sort()) sc.push(run.trickCounts[k]);
    out[7] = hashNums(sc);
    const tm = run._teleMarks || [];
    const tl = [tm.length];
    for (const m of tm) for (const v of Object.values(m)) if (typeof v === 'number') tl.push(v);
    out[8] = hashNums(tl);
    return out;
  }

  // ---- Math op tracing (second pass, only when a divergence was found). Per tick and function: call count, hash of
  // arguments and hash of results. A tick where arguments match but results differ names the op whose implementation differs.
  const MATH_FNS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'pow', 'exp', 'log', 'sqrt', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh', 'expm1', 'log1p', 'log2', 'log10'];
  S.MATH_FNS = MATH_FNS;
  const resetMath = () => { for (const n of MATH_FNS) { const c = S.math.cur[n]; c.n = 0; c.a = 0x811c9dc5 | 0; c.r = 0x811c9dc5 | 0; } };
  function installMathTrace() {
    if (S.math) return;
    const real = {};
    const st = (S.math = { cur: {}, ticks: [], calls: [], captureOn: false, captureTicks: [], active: false });
    for (const n of MATH_FNS) {
      real[n] = Math[n];
      st.cur[n] = { n: 0, a: 0, r: 0 };
      Math[n] = function (...args) {
        const r = real[n].apply(Math, args);
        if (!st.active) return r;
        const c = st.cur[n];
        c.n++;
        c.a = Math.imul(c.a ^ hashNums(args), 0x01000193) | 0;
        c.r = Math.imul(c.r ^ hashNums([r]), 0x01000193) | 0;
        if (st.captureOn) st.calls.push([st.capTick, n, args.slice(), r]);
        return r;
      };
    }
    resetMath();
  }

  function ensureHooks(run) {
    if (run.__ceHooked) return;
    run.__ceHooked = true;
    const realUpdate = run.update;
    run.update = function (t, d) { if (!S.hold) return realUpdate.call(this, t, d); };
    const realCrash = run.doCrash;
    run.doCrash = function (c, fs, sp) { if (S.current) S.current.cause = c && c.cause; return realCrash.call(this, c, fs, sp); };
    const realTick = run.simTick;
    run.simTick = function (d, pad) {
      const cur = S.current;
      const m = S.math;
      if (cur && m && m.active) { resetMath(); m.captureOn = m.captureTicks.includes(this.simClock.tick); m.capTick = this.simClock.tick; }
      const r = realTick.call(this, d, pad);
      if (cur && !cur.done) {
        if (m && m.active) { const row = []; for (const n of MATH_FNS) { const c = m.cur[n]; row.push(c.n, c.a, c.r); } m.ticks.push(row); m.captureOn = false; }
        cur.digests.push(digest(this));
        cur.raw.push(sampleRaw(this));
        const pairs = this.matter.world.engine.pairs.list.filter((p) => p.isActive).length;
        if (pairs > 0) cur.contactTicks++;
        if (pairs > cur.maxPairs) cur.maxPairs = pairs;
        if (!this.sled.grounded) cur.airTicks++;
        if ((this.sled.parachuteMs || 0) > 0) cur.chuteTicks++;
        if (this.sled.airBrakeActive) cur.airBrakeTicks++;
        if (this.bsodState && this.bsodState.active) cur.bsodActiveTicks++;
        if (this.bsodCaught) cur.bsodCaught = true;
        if (this.kodiaks && this.kodiaks.length) cur.kodiakTicks++;
        let ci = 0;
        for (const c of this.terrain.activeList || []) ci = Math.max(ci, c.index || 0);
        if (ci > cur.maxChunk) cur.maxChunk = ci;
        cur.maxSector = Math.max(cur.maxSector, Math.floor((this.sled.x - this.startX) / 20 / 500));
        for (const [k, v] of Object.entries(this.trickCounts || {})) cur.tricks[k] = v;
        // Coarse cadences can run past the tape end inside the last frame; the outcome is the state AT the target tick.
        if (cur.target && !cur.snap && this.simClock.tick >= cur.target) cur.snap = outcome(this, cur);
      }
      return r;
    };
  }

  async function bootRun(o) {
    const g = window.__bbGame;
    const run = g.scene.getScene('RunScene');
    ensureHooks(run);
    S.hold = true;
    if (!S.rasterReal) S.rasterReal = g.renderer.render;
    g.renderer.render = o.raster ? S.rasterReal : function () {};
    g.loop.wake();
    const title = g.scene.getScene('TitleScene');
    // Return to a clean Title between runs of one session (the previous run's scenes are stopped).
    if (!title.sys.isActive() || run.sys.isActive()) {
      for (const sc of g.scene.getScenes(true)) if (sc.sys.settings.key !== 'TitleScene') g.scene.stop(sc.sys.settings.key);
      if (!title.sys.isActive()) g.scene.start('TitleScene');
      await new Promise((res) => { const w = () => (title.sys.isActive() ? res() : requestAnimationFrame(w)); w(); });
      await new Promise((r) => setTimeout(r, 150));
    }
    title.starting = false;
    const prof = g.registry.get('profile');
    if (prof && typeof prof === 'object') prof.level = Number.isFinite(o.level) ? o.level : (o.kodiaks ? 8 : 1);
    if (o.tape) g.registry.set('ghostReplay', o.tape);
    title.startRun(o.seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled && run.simClock && run.simClock.tick === 0 && !run.crashed ? res() : requestAnimationFrame(w)); w(); });
    await new Promise((r) => setTimeout(r, 120));
    g.loop.sleep();
    return { g, run };
  }

  function newCur() {
    return { done: false, digests: [], raw: [], contactTicks: 0, maxPairs: 0, airTicks: 0, chuteTicks: 0, airBrakeTicks: 0, bsodActiveTicks: 0, bsodCaught: false,
      kodiakTicks: 0, maxChunk: 0, maxSector: 0, tricks: {} };
  }

  // ---- recording autopilot (recording only; replay never calls it). Deterministic small PRNG so fixtures are reproducible.
  function mulberry(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function makePad() {
    return { push: false, variableHop: false, noAutoNudge: false, divebomb: false, corkscrew: false, tuck: false, brakeHeld: false, brake: false, hop: false, reset: false, airBrake: false,
      parachute: false, pause: false, tilt: 0, heli: 0, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
  }

  function controller(run, style, params, rand) {
    const P = { tiltSign: 1, ...params };
    let mode = 0, lastHop = -999;
    return () => {
      const s = run.sled, tk = run.simClock.tick + 1, pad = makePad();
      const grounded = s.grounded;
      const slope = run.slopeAt(s.x) * Math.PI / 180;
      const air = s.airtimeMs || 0;
      const align = () => {
        const land = Number.isFinite(s.airSlopeDeg) ? s.airSlopeDeg * Math.PI / 180 : slope;
        const err = land - s.body.angle - 0.2 * s.body.angularVelocity;
        pad.tilt = Math.max(-1, Math.min(1, err * 4)) * P.tiltSign;
      };
      let hazardHop = false;
      if (grounded && !P.noHazardHop && tk - lastHop > 50) {
        for (const l of run.hazards.values()) for (const h of l) {
          const dx = h.cx - s.x;
          if (!h.hit && !h.destroyed && dx > 30 && dx < 50 + s.vx * (P.lead || 0.3)) hazardHop = true;
        }
      }
      if (hazardHop) lastHop = tk;
      if (style === 'idle') { pad.brakeHeld = true; return pad; }
      if (style === 'bsod') {
        pad.push = grounded && s.vx < 380;
        if (hazardHop) { pad.pressed.hop = pad.hop = true; pad.variableHop = true; }
        if (tk > (P.brakeAt || 1500)) { pad.brakeHeld = true; pad.push = false; if (P.resetEvery && tk % P.resetEvery === 0) pad.pressed.reset = pad.reset = true; }
        if (!grounded) align();
        return pad;
      }
      if (style === 'reckless') {
        pad.push = true; pad.tuck = grounded;
        if ((grounded && tk % (P.hopEvery || 240) === 0) || hazardHop) pad.pressed.hop = pad.hop = true;
        if (!grounded && rand() < 0.02) mode = rand() < 0.5 ? -1 : 1;
        if (!grounded) pad.tilt = mode * 0.6;
        return pad;
      }
      pad.push = grounded && s.vx < (P.vmax || 520);
      pad.tuck = grounded && Math.abs(slope) > 0.35 && !!P.tuck;
      if (hazardHop || (grounded && !P.noPeriodicHop && tk % (P.hopEvery || 420) === 0)) { pad.pressed.hop = pad.hop = true; pad.variableHop = true; }
      if (!grounded) {
        const eta = s.airEtaMs;
        const late = Number.isFinite(eta) ? eta < 450 : air > 1300;
        if (style === 'tricks' && !late) {
          if (air > 120) pad.heli = (Math.floor(tk / 360) % 2) ? 1 : -1;
          if (air > 500 && (Math.floor(tk / 240) % 3 === 0)) pad.corkscrew = true;
          if (air > 700 && (Math.floor(tk / 300) % 4 === 0)) pad.divebomb = true;
        } else if (style === 'chute') {
          if (!late && air > 350 && air < 1500) { pad.parachute = true; if (!s.chuteUsed) pad.pressed.parachute = true; }
          if (!late && air > 1500) { pad.airBrake = true; if (tk % 90 === 0) pad.pressed.airBrake = true; }
        }
        if (late || style === 'cruise' || style === 'chute') align();
      } else if (style === 'chute' && tk % 360 === 0) { pad.pressed.airBrake = pad.airBrake = true; pad.brakeHeld = true; }
      return pad;
    };
  }

  async function finishCur(run, g, cur, o) {
    cur.done = true;
    let tape = null;
    if (run.crashed) {
      await new Promise((r) => setTimeout(r, 500));
      tape = g.registry.get('lastGhostTape') || null;
    }
    if (!tape && run.ghostRecorder) {
      const snap = run.score.getSnapshot();
      tape = run.ghostRecorder.finish({ runId: 'conformance-' + o.seed, distanceM: Math.floor(snap.distanceM), score: Math.round(snap.total), endedAt: 0 });
    }
    return tape;
  }

  function outcome(run, cur) {
    const snap = run.score.getSnapshot();
    return { ticks: run.simClock.tick, crashed: !!run.crashed, cause: run.crashed ? (cur.cause || 'unknown') : null,
      distanceM: Math.floor(snap.distanceM), score: Math.max(0, Math.round(snap.total)), x: run.sled.x, y: run.sled.y,
      stats: { contactTicks: cur.contactTicks, maxPairs: cur.maxPairs, airTicks: cur.airTicks, chuteTicks: cur.chuteTicks, airBrakeTicks: cur.airBrakeTicks,
        bsodActiveTicks: cur.bsodActiveTicks, bsodCaught: cur.bsodCaught, kodiakTicks: cur.kodiakTicks, maxChunk: cur.maxChunk, maxSector: cur.maxSector, tricks: cur.tricks,
        kodiaksOn: !!run.kodiaksOn, biomeMask: run.biomeMask >>> 0 } };
  }

  /** Play one run: live autopilot (record) or a tape (replay). Returns outcome, digests, raw and (record only) the tape. */
  S.play = async (o) => {
    const { g, run } = await bootRun(o);
    const cur = (S.current = newCur());
    cur.target = o.tape ? o.tape.endTick + 1 : 0;
    const rand = mulberry(o.rngSeed || 1);
    run.inputRouter.poll = o.tape ? () => makePad() : controller(run, o.style || 'cruise', o.params || {}, rand);
    if (o.mathTrace) { installMathTrace(); S.math.ticks = []; S.math.calls = []; S.math.captureTicks = o.captureTicks || []; S.math.active = true; }
    else if (S.math) S.math.active = false;
    S.hold = false;
    const dt = 1000 / o.hz;
    // A tape's endTick is its last COMPLETED tick; a crash happens on endTick + 1, so replay one tick further.
    const endTick = o.tape ? o.tape.endTick + 1 : o.maxTicks;
    let t = 0, frames = 0;
    const cap = (endTick * 8.34) / dt + 600;
    while (!run.crashed && run.simClock.tick < endTick && frames < cap) {
      t += dt; frames++;
      g.step(t, dt);
    }
    S.hold = true;
    const tape = await finishCur(run, g, cur, o);
    const keep = o.tape ? cur.target : cur.digests.length;
    const out = { outcome: cur.snap || outcome(run, cur), frames, digests: cur.digests.slice(0, keep), raw: cur.raw.slice(0, keep), tape: o.tape ? null : tape,
      tapeCheck: o.tape ? { desync: run.tapePlayer ? run.tapePlayer.desync : null, checked: run.tapePlayer ? run.tapePlayer.checked : 0 } : null };
    if (S.math && S.math.active) { out.math = S.math.ticks; out.mathCalls = S.math.calls; S.math.active = false; }
    S.current = null;
    return out;
  };

  S.detNames = () => Object.keys(DET);
  S.env = () => ({ ua: navigator.userAgent, platform: navigator.platform, hw: navigator.hardwareConcurrency, dpr: window.devicePixelRatio,
    renderType: window.__bbGame.config.renderType,
    gl: (() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return null; const e = gl.getExtension('WEBGL_debug_renderer_info');
      return { version: gl.getParameter(gl.VERSION), renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : null }; } catch (e) { return null; } })() });
})();
