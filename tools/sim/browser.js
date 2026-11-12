/*
 * Page-side half of the sim harness (loaded with page.addInitScript by run.mjs; plain script, no imports).
 *
 * Determinism measures (see run.mjs header):
 *  - Math.random is replaced by a seeded PRNG that is re-seeded at the start of every run.
 *  - Date / Date.now are pinned to a fixed instant that advances by exactly one frame per step.
 *  - the daily rule is neutralised after RunScene.create (scene.dailyMods = {}), localStorage is cleared per run.
 *  - Phaser's own loop is stopped; the game is advanced with game.headlessStep(t, 1000/60).
 *  - RunScene.inputRouter is replaced by a stub that returns the scripted policy's pad each frame.
 */
(() => {
  'use strict';
  const DT = 1000 / 60;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- pinned clock + seeded RNG
  const RealDate = Date;
  let simClockMs = RealDate.UTC(2026, 0, 5, 12, 0, 0);
  class SimDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(simClockMs); else super(...a); }
    static now() { return simClockMs; }
  }
  window.Date = SimDate;

  function mulberry32(a) {
    return function rnd() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  let rng = mulberry32(1);
  let rngCalls = 0;
  Math.random = () => { rngCalls++; return rng(); };

  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

  let mods = null;
  async function loadMods() {
    if (mods) return mods;
    const [ev, con, tun] = await Promise.all([
      import('/src/events.js'), import('/src/constants.js'), import('/src/systems/PhysicsTuner.js'),
    ]);
    mods = { EVT: ev.EVT, REG: con.REG, PPM: con.PIXELS_PER_METER, TUNING: tun.TUNING };
    return mods;
  }

  function newPad() {
    return {
      push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
      parachute: false, pause: false, lastSource: 'keyboard',
      pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
    };
  }

  // ---------------------------------------------------------------- policies
  /** Ballistic landing ETA (ms) from the current state, ignoring drag; 3000 when nothing is hit. */
  function etaToGround(scene) {
    const s = scene.sled;
    const g = (scene.currentPhys && scene.currentPhys.gravityPxS2) || 900;
    for (let t = 10; t <= 3000; t += 10) {
      const ts = t / 1000;
      const x = s.x + s.vx * ts;
      const y = s.y + s.vy * ts + 0.5 * g * ts * ts;
      if (y + 14 >= scene.terrain.heightAt(x)) return t;
    }
    return 3000;
  }

  function makePolicies(M) {
    const { TUNING, PPM } = M;
    let policies_hop = null;
    const policies = {
      /** No input at all. */
      handsOff() { return () => null; },

      /**
       * Hands-off in the air; on the ground press hop so that the apex is over the next ground crash-hazard
       * (hopLeadMs before reaching its centre). Never hops within [lip-hopLipBeforePx, lip+hopLipAfterPx] of a launch lip
       * whose chunk has an air hazard after it.
       */
      hop(p) {
        const lead = p.hopLeadMs != null ? p.hopLeadMs : 380;
        const before = p.hopLipBeforePx != null ? p.hopLipBeforePx : 260;
        const after = p.hopLipAfterPx != null ? p.hopLipAfterPx : 80;
        let lastHop = -1e9;
        return (c) => {
          const { scene, sled } = c;
          if (!sled.grounded || c.tMs - lastHop < 700) return null;
          const vx = Math.max(sled.vx, 60);
          let want = false;
          for (const list of scene.hazards.values()) {
            for (const h of list) {
              if (h.hit || h.def.placement === 'air') continue;
              if (!(!h.def.onHit || h.def.onHit.effect === 'crash')) continue;
              const dx = h.cx - sled.x;
              if (dx > 0 && dx / vx * 1000 <= lead && dx / vx * 1000 > lead - 250) { want = true; break; }
            }
            if (want) break;
          }
          if (!want) return null;
          // veto near a lip that has an air hazard after it
          for (const ch of scene.terrain.activeList) {
            if (!ch.launches || !ch.launches.length || !ch.hazards || !ch.hazards.length) continue;
            for (const hz of ch.hazards) {
              const d = scene.content.hazards[hz.defId];
              if (!d || d.placement !== 'air') continue;
              for (const l of ch.launches) {
                if (l.x < hz.x && sled.x > l.x - before && sled.x < l.x + after) return null;
              }
            }
          }
          lastHop = c.tMs;
          return { hop: true };
        };
      },

      /**
       * Hop layer (same rules as `hop`, disable with --noHop) + flip layer: hold back-tilt (tilt -1 = counter-clockwise =
       * backflip) during air phases where a flip is FEASIBLE.
       * Feasible = a forward model of the sled's own air-rotation rules (Sled.applyControls: air torque while held, then
       * spin-down + auto-level toward the travel direction once released) says that holding for SOME duration and then
       * letting go gives, at the ballistic touchdown, >= 340 deg of net ccw rotation and a landing angle within
       * flipCleanDeg (default 12 = the 'perfect' threshold) of the ground slope there.
       * IDEAL release = the earliest frame at which that is true for "let go right now". --releaseLateMs N keeps
       * holding N ms beyond that frame (the later, the more it overshoots). Phases that are not feasible get no input.
       * If the ETA drops below 150 ms before the ideal frame was found, the policy lets go anyway.
       * Air-phase records carry flip:{hold, etaMs, holdMs, idealRot, idealFound} plus the landing quality/angle.
       */
      flip(p) {
        const late = p.releaseLateMs || 0;
        const clean = p.flipCleanDeg != null ? p.flipCleanDeg : 12;
        const hopLayer = p.noHop ? null : policies_hop(p);
        const K = TUNING.airIdleLevelK;
        const damp = TUNING.airIdleSpinDamp;
        const wMax = TUNING.maxAngularVelDegS * DEG;
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        // forward model: hold tilt -1 for holdMs, then hands-off, until etaMs. Returns net ccw rotation (deg) since launch
        // and the landing angle error vs ground slope (deg).
        const predict = (c, holdMs, etaMs, ang0Launch) => {
          const sled = c.sled;
          const ph = c.scene.currentPhys || {};
          const g = ph.gravityPxS2 || 900;
          const torque = ((ph.tiltTorqueDegS2 || 0) * (ph.airControl || 0) * (ph.steerMul == null ? 1 : ph.steerMul) * (ph.tiltSign == null ? 1 : ph.tiltSign)) * DEG;
          let ang = sled.body.angle;
          let w = sled.body.angularVelocity * 60; // rad/s, clockwise positive
          let vy = sled.vy;
          const vx = sled.vx;
          const h = 1 / 120;
          const n = Math.max(1, Math.round(etaMs / 1000 / h));
          const nh = Math.round(holdMs / 1000 / h);
          for (let i = 0; i < n; i++) {
            vy += g * h;
            if (i < nh) {
              w -= torque * h; // tilt -1
            } else {
              const err = wrap(Math.atan2(vy, vx) - ang);
              w += Math.max(-1.2, Math.min(1.2, err)) * K * h;
              w *= Math.exp(-damp * h);
            }
            w = Math.max(-wMax, Math.min(wMax, w));
            ang += w * h;
          }
          const finalDeg = ang / DEG;
          const slope = c.scene.terrain.slopeDegAt(sled.x + (vx * etaMs) / 1000);
          return { rotCcw: ang0Launch - finalDeg, errDeg: wrap((finalDeg - slope) * DEG) / DEG };
        };
        const ok = (pr) => pr.rotCcw >= 340 && Math.abs(pr.errDeg) <= clean;
        let st = null;
        return (c) => {
          const { scene, sled } = c;
          const hopOut = hopLayer ? hopLayer(c) : null;
          if (sled.grounded) { st = null; c.flip = null; return hopOut; }
          if (!st) {
            const eta = etaToGround(scene);
            let feasible = false;
            for (let hm = 0; hm <= eta && !feasible; hm += 25) feasible = ok(predict(c, hm, eta, sled.angleDeg));
            st = { ang0: sled.angleDeg, hold: feasible, releaseAt: null, etaMs: eta, holdMs: 0, idealRot: null, idealFound: false };
            c.flip = st;
          }
          if (!st.hold) return null;
          if (st.releaseAt == null) {
            const eta = etaToGround(scene);
            if (ok(predict(c, 0, eta, st.ang0))) { st.releaseAt = c.tMs + late; st.idealFound = true; }
            else if (eta < 150) st.releaseAt = c.tMs;
            if (st.releaseAt != null) st.idealRot = st.ang0 - sled.angleDeg;
          }
          const released = st.releaseAt != null && c.tMs >= st.releaseAt;
          if (!released) st.holdMs += DT;
          return released ? null : { tilt: -1 };
        };
      },

      /** Brake to a dead stop on gentle ground, release, watch the stall nudge. Records into c.probe. */
      stallProbe(p) {
        const stopBelow = p.stopBelowPxS != null ? p.stopBelowPxS : 3;
        const st = { phase: 'brake', tStop: null, tSlow: null, tNudge: null, tRecover: null, minSpeedAfter: 1e9, slopeAtStop: null, x: null, maxBrakeMs: 25000 };
        return (c) => {
          const { sled } = c;
          c.probe = st;
          if (st.phase === 'brake') {
            if (sled.grounded && sled.speed < stopBelow && Math.abs(sled.groundAngleDeg) < TUNING.stallNudgeMaxSlopeDeg) {
              st.phase = 'released'; st.tStop = c.tMs; st.slopeAtStop = r1(sled.groundAngleDeg); st.x = r1((sled.x - c.scene.startX) / PPM);
              return null;
            }
            if (c.tMs > st.maxBrakeMs) { st.phase = 'neverStopped'; return null; }
            return { brake: true };
          }
          if (st.phase === 'released') {
            st.minSpeedAfter = Math.min(st.minSpeedAfter, Math.round(sled.speed));
            if (st.tSlow == null && sled.grounded && sled.speed < TUNING.stallNudgeBelowPxS) st.tSlow = c.tMs;
            if (st.tNudge == null && sled._nudging) st.tNudge = c.tMs;
            if (st.tRecover == null && sled.speed > 120) { st.tRecover = c.tMs; st.phase = 'done'; }
            if (c.tMs - st.tStop > 20000) st.phase = 'timeout';
          }
          return null;
        };
      },
    };
    policies_hop = policies.hop;
    return policies;
  }

  // ---------------------------------------------------------------- one run
  async function run(o) {
    const M = await loadMods();
    const { EVT, REG, PPM, TUNING } = M;
    const game = window.__bbGame;
    const params = o.params || {};
    const policyName = o.policy || 'handsOff';
    const maxM = o.maxM != null ? o.maxM : 3000;
    const maxMs = (o.maxSec != null ? o.maxSec : 240) * 1000;
    const traceEvery = o.traceEvery || 0;
    const keepUi = !!o.keepUi;
    const policies = makePolicies(M);
    if (!policies[policyName]) throw new Error('unknown policy ' + policyName);
    const policy = policies[policyName](params);

    try { localStorage.clear(); } catch (e) { /* ignore */ }
    rng = mulberry32(hashStr(`${o.seed}|${policyName}|rng`));
    rngCalls = 0;
    simClockMs = RealDate.UTC(2026, 0, 5, 12, 0, 0);

    // clean slate: stop everything, no audio, no saved runs (best marker)
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) {
      try { game.scene.stop(k); } catch (e) { /* ignore */ }
    }
    // AudioSynth subscribes to game.events itself and draws Math.random only when its AudioContext happens to be running
    // (wall-clock dependent), so silence it completely
    const audio = game.registry.get(REG.AUDIO);
    if (audio) {
      for (const k of ['playSfx', 'glitch', 'setSpeed', 'setIntensity', 'startMusic', 'stopMusic', 'duckMusic', 'unlock', '_updateIntensity', '_onLanding', '_sfx', '_noise', '_osc']) audio[k] = () => {};
    }
    game.registry.set(REG.AUDIO, null);
    const store = game.registry.get(REG.SAVE_STORE);
    if (store && Array.isArray(store.runs)) store.runs.length = 0;
    game.registry.set(REG.SEED, o.seed);

    const pad = newPad();
    let curPad = pad;
    const stub = { poll() { return curPad; }, setEnabled() {} };

    let scene = null;
    game.events.once(EVT.RUN_START, () => {
      scene = game.scene.getScene('RunScene');
      scene.inputRouter = stub;
      scene.dailyMods = {};
      scene.dailyRuleId = 'none';
      if (!keepUi) game.scene.stop('UIScene');
    });

    // ---- recorders
    const R = {
      seed: o.seed, policy: policyName, params,
      endReason: null, distM: 0, simSec: 0, frames: 0,
      crash: null, negatedCrashes: [], airPhases: [], landings: [], respawns: [], nudges: [], hints: [], hazardHits: [],
      maxSpeed: 0, maxSpeedAtM: 0, minZoom: 99, minZoomAtM: 0, zoomAtMaxSpeed: 0,
      bands: {}, generatedToM: 0, openingGraces: 0, trace: [],
    };
    let tMs = 0; // run clock as the harness sees it (frames * DT)
    let lastLanding = null;
    let pendingLand = null;
    let lastAir = null; // last finished air phase
    let air = null;
    let prevGrounded = true;
    let lastHopFrame = -1e9;
    let prevGraces = 0;
    let prevNudging = false;
    let lastSeenChunk = -1;
    const chunkRecs = new Map();
    let crashEvent = null;
    const lead = [];
    const distOf = (x) => (x - scene.startX) / PPM;

    const on = (name, fn) => { game.events.on(name, fn); return () => game.events.off(name, fn); };
    const offs = [];
    offs.push(on(EVT.CRASH, (e) => {
      if (e.negated) { R.negatedCrashes.push({ cause: e.cause, distM: r1(distOf(e.x)), tSec: r2(tMs / 1000) }); return; }
      crashEvent = e;
    }));
    offs.push(on(EVT.LANDING, (e) => {
      pendingLand = { quality: e.quality, angleDeg: r1(e.angleDeg), impactSpeedPxS: Math.round(e.impactSpeedPxS) };
      lastLanding = { quality: e.quality, angleDeg: r1(e.angleDeg), impactSpeedPxS: Math.round(e.impactSpeedPxS), airtimeMs: Math.round(e.airtimeMs), distM: r1(distOf(e.x)), tMs, hard: !!e.hard };
      R.landings.push({ ...lastLanding, tSec: r2(tMs / 1000), tMs: undefined });
    }));
    offs.push(on(EVT.RESPAWN, (e) => {
      const grace = scene.openingGraces > prevGraces;
      prevGraces = scene.openingGraces;
      R.respawns.push({ reason: e.reason, grace, distM: r1(distOf(e.x)), tSec: r2(tMs / 1000) });
    }));
    offs.push(on(EVT.TUTORIAL_HINT, (e) => {
      R.hints.push({ id: e.id, show: e.show, tSec: r2(tMs / 1000), distM: r1(distOf(scene.sled.x)) });
    }));
    offs.push(on(EVT.HAZARD_HIT, (e) => {
      R.hazardHits.push({ id: e.hazardId, effect: e.effect, distM: r1(distOf(e.x)) });
    }));

    function classifyStart(x0) {
      // nearest launch lip (any chunk) within window; bounce pad; own hop; else other
      let best = null;
      for (const ch of scene.terrain.activeList) {
        if (x0 < ch.startX - 200 || x0 > ch.endX + 200) continue;
        for (const l of ch.launches || []) {
          const d = x0 - l.x;
          if (d >= -80 && d <= 160 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l, ch };
        }
        if (!best) {
          for (const bp of ch.bouncePads || []) {
            if (Math.abs(x0 - bp.x) <= bp.width / 2 + 60) return { where: 'bounce', chunk: ch.index, defId: ch.defId };
          }
        }
      }
      if (best) {
        const gen = best.ch.defId === 'gen-jump';
        return {
          where: gen ? 'genJump' : 'templateLip', chunk: best.ch.index, defId: best.ch.defId, lipD: Math.round(best.d),
          predAirS: r2(best.l.airS), lipAngleDeg: r1(best.l.angleDeg),
        };
      }
      return { where: 'other' };
    }

    function closeAir(endedByCrash) {
      if (!air) return;
      if (air.airMs > 120) {
        R.airPhases.push({
          tEndSec: r2(tMs / 1000), startM: r1(air.startM), launchSpeed: Math.round(air.speed0), vy0: Math.round(air.vy0), airMs: Math.round(air.airMs),
          hop: air.hop, ...air.cls, rotDeg: Math.round(air.ang0 - air.lastAng), endedByCrash: !!endedByCrash,
          landing: pendingLand ? pendingLand.quality : null, landAngleDeg: pendingLand ? pendingLand.angleDeg : null,
          landImpactPxS: pendingLand ? pendingLand.impactSpeedPxS : null,
          flip: ctx.flip ? { hold: ctx.flip.hold, etaMs: ctx.flip.etaMs, holdMs: Math.round(ctx.flip.holdMs), idealRot: ctx.flip.idealRot == null ? null : Math.round(ctx.flip.idealRot), idealFound: ctx.flip.idealFound } : null,
        });
      }
      lastAir = { airMs: air.airMs, endT: tMs };
      air = null;
      pendingLand = null;
    }

    function scanChunks() {
      const list = scene.terrain.activeList;
      if (!list.length) return;
      const lastIdx = list[list.length - 1].index;
      if (lastIdx === lastSeenChunk) return;
      lastSeenChunk = lastIdx;
      for (const ch of list) {
        if (chunkRecs.has(ch.index)) continue;
        chunkRecs.set(ch.index, {
          i: ch.index, defId: ch.defId, kind: ch.kind, x0: ch.startX, x1: ch.endX,
          haz: (ch.hazards || []).map((h) => [h.defId, h.x]),
          lips: (ch.launches || []).map((l) => l.x), pads: (ch.bouncePads || []).length, gaps: (ch.gaps || []).length,
        });
      }
    }

    // ---- start: first headlessStep processes the queue, creates RunScene (RUN_START hook installs the stub)
    game.registry.set(REG.SEED, o.seed);
    game.scene.start('RunScene');
    const wall0 = performance.now();
    let guard = 0;
    while (!scene && guard++ < 5) { game.headlessStep(0, DT); }
    if (!scene) throw new Error('RunScene did not start');
    // the first headlessStep already ran frame 0 inside the loop above only if RunScene was created there
    let frame = 0;
    let stallRef = { t: 0, x: scene.sled.x };
    scanChunks();
    // NB: the loop above executed one update with an empty pad (all-zero), which is deterministic.

    const ctx = { scene, sled: scene.sled, tMs: 0, frame: 0, probe: null, flip: null };
    let endReason = null;
    const probeMode = policyName === 'stallProbe';

    while (!endReason) {
      const sled = scene.sled;
      ctx.tMs = tMs; ctx.frame = frame;
      const out = policy(ctx) || null;
      const np = newPad();
      if (out) {
        if (out.tilt != null) np.tilt = out.tilt;
        if (out.brake) np.brake = true;
        if (out.tuck) np.tuck = true;
        if (out.hop) { np.hop = true; np.pressed.hop = true; lastHopFrame = frame; }
      }
      curPad = np;

      game.headlessStep(tMs, DT);
      simClockMs += DT;
      tMs += DT;
      frame++;

      // ---- observe
      const s = scene.sled;
      const distM = distOf(s.x);
      if (s.speed > R.maxSpeed) { R.maxSpeed = s.speed; R.maxSpeedAtM = distM; R.zoomAtMaxSpeed = scene.cameras.main.zoom; }
      const z = scene.cameras.main.zoom;
      if (z < R.minZoom) { R.minZoom = z; R.minZoomAtM = distM; }
      scanChunks();

      const g = s.grounded;
      if (!g && prevGrounded) {
        air = { ang0: s.angleDeg, lastAng: s.angleDeg, startM: distM, speed0: s.speed, vy0: s.vy, airMs: 0, hop: frame - lastHopFrame <= 15, cls: classifyStart(s.x), startFrame: frame };
      }
      if (air) { air.airMs = Math.max(air.airMs, s.airtimeMs); air.lastAng = s.angleDeg; }
      if (g && !prevGrounded) closeAir(false);
      prevGrounded = g;

      if (s._nudging && !prevNudging) R.nudges.push({ tSec: r2(tMs / 1000), distM: r1(distM), speed: Math.round(s.speed), slope: r1(s.groundAngleDeg) });
      prevNudging = s._nudging;

      // rolling pre-crash buffer (every 3rd frame): [tMs, distM, angle rel. to slope, angular vel deg/s, grounded, speed, slope, tilt held, hop pressed]
      if (frame % 3 === 0) {
        lead.push([Math.round(tMs), r1(distM), r1(s.angleDeg - s.groundAngleDeg), Math.round((s.body.angularVelocity * 60) / DEG), g ? 1 : 0, Math.round(s.speed), r1(s.groundAngleDeg), np.tilt, np.pressed.hop ? 1 : 0]);
        if (lead.length > 40) lead.shift();
      }
      if (traceEvery && frame % traceEvery === 0) R.trace.push([s.x, s.y, s.angleDeg, rngCalls]);

      if (scene.crashed || crashEvent) {
        const e = crashEvent || {};
        const speed = e.speedPxS != null ? e.speedPxS : s.speed;
        const cx = e.x != null ? e.x : s.x;
        const ch = scene.terrain.getChunkAt(cx);
        let slope = null;
        try { slope = scene.terrain.slopeDegAt(cx); } catch (err) { /* ignore */ }
        const airNow = air ? air.airMs : 0;
        R.crash = {
          cause: e.cause, hazardId: e.hazardId || null, distM: r1(distOf(cx)), tSec: r2(tMs / 1000),
          slopeDeg: r1(slope), speedPxS: Math.round(speed), airborneMs: Math.round(airNow),
          lastAirMs: lastAir ? Math.round(lastAir.airMs) : null, msSinceLastAir: lastAir ? Math.round(tMs - lastAir.endT) : null,
          lastLanding: lastLanding ? { ...lastLanding, msBefore: Math.round(tMs - lastLanding.tMs) } : null,
          chunkDefId: ch ? ch.defId : null, chunkKind: ch ? ch.kind : null, chunkIndex: ch ? ch.index : null,
          grounded: !!g, angleDeg: r1(s.angleDeg), invulnerableMs: Math.round(s.invulnerableMs || 0),
        };
        if (R.crash.lastLanding) delete R.crash.lastLanding.tMs;
        R.crash.lead = lead.map((l) => [Math.round(l[0] - tMs), ...l.slice(1)]);
        closeAir(true);
        endReason = 'crash:' + (e.cause || 'unknown');
        break;
      }
      if (!probeMode && distM >= maxM) { endReason = 'maxM'; break; }
      if (tMs >= maxMs) { endReason = 'timeout'; break; }
      if (probeMode) {
        const pr = ctx.probe;
        if (pr && (pr.phase === 'done' || pr.phase === 'timeout' || pr.phase === 'neverStopped')) { endReason = 'probe:' + pr.phase; break; }
      } else if (tMs - stallRef.t >= 10000) {
        if ((s.x - stallRef.x) / PPM < 2) { endReason = 'stalled'; break; }
        stallRef = { t: tMs, x: s.x };
      }
    }

    // ---- finalise
    closeAir(false);
    R.endReason = endReason;
    R.distM = r1(distOf(scene.sled.x));
    R.simSec = r2(tMs / 1000);
    R.frames = frame;
    R.openingGraces = scene.openingGraces;
    R.maxSpeed = Math.round(R.maxSpeed);
    R.minZoom = r2(R.minZoom);
    R.zoomAtMaxSpeed = r2(R.zoomAtMaxSpeed);
    R.tutorialShown = [...scene.tutShown];
    R.tutorialDone = [...scene.tutDone];
    if (ctx.probe) R.probe = ctx.probe;
    R.bands = bandsFrom(scene, chunkRecs, PPM, scene.startX);
    R.generatedToM = r1(((scene.terrain.activeList.length ? scene.terrain.activeList[scene.terrain.activeList.length - 1].endX : 0) - scene.startX) / PPM);
    R.wallMs = Math.round(performance.now() - wall0);
    for (const f of offs) f();
    try { game.scene.stop('RunScene'); game.scene.stop('UIScene'); game.headlessStep(tMs, DT); } catch (e) { /* ignore */ }
    return R;
  }

  function bandsFrom(scene, chunkRecs, PPM, startX) {
    const bands = {};
    const B = (b) => (bands[b] || (bands[b] = { crash: 0, groundCrash: 0, airCrash: 0, total: 0, genJumps: 0, templateLips: 0, bridges: 0, byDef: {} }));
    const defs = scene.content.hazards;
    for (const rec of chunkRecs.values()) {
      for (const [defId, x] of rec.haz) {
        const b = Math.floor(((x - startX) / PPM) / 500);
        if (b < 0) continue;
        const d = defs[defId] || {};
        const crash = !d.onHit || d.onHit.effect === 'crash';
        const air = d.placement === 'air';
        const o = B(b);
        o.total++; o.byDef[defId] = (o.byDef[defId] || 0) + 1;
        if (crash) { o.crash++; if (air) o.airCrash++; else o.groundCrash++; }
      }
      for (const lx of rec.lips) {
        const b = Math.floor(((lx - startX) / PPM) / 500);
        if (b < 0) continue;
        if (rec.defId === 'gen-jump') B(b).genJumps++; else B(b).templateLips++;
      }
      if (rec.kind === 'bridge') { const b = Math.floor(((rec.x0 - startX) / PPM) / 500); if (b >= 0) B(b).bridges++; }
    }
    return bands;
  }

  // ---------------------------------------------------------------- terrain-only generation (no physics)
  async function genTerrain(o) {
    const M = await loadMods();
    const { PPM } = M;
    const game = window.__bbGame;
    const maxM = o.maxM || 4000;
    // borrow content + generator class from a throw-away RunScene-free path: use registry content and the scene's class if any
    const content = game.registry.get(M.REG.CONTENT);
    const TG = (await import('/src/systems/TerrainGenerator.js')).TerrainGenerator;
    const tg = new TG({
      seed: String(o.seed), chunkDefs: content.chunks, hazardDefs: content.hazards, powerupDefs: content.powerups, modDefs: content.terrainMods,
    });
    const chunkRecs = new Map();
    for (let i = 0; ; i++) {
      const ch = tg.getChunk(i);
      chunkRecs.set(i, {
        i, defId: ch.defId, kind: ch.kind, x0: ch.startX, x1: ch.endX,
        haz: (ch.hazards || []).map((h) => [h.defId, h.x]),
        lips: (ch.launches || []).map((l) => l.x), pads: (ch.bouncePads || []).length, gaps: (ch.gaps || []).length,
      });
      if (ch.endX / PPM > maxM + 500) break;
    }
    // a real run measures distance from startX = 44 px (RunScene SPAWN_RUNIN_PX); use the same origin here
    const bands = bandsFrom({ content }, chunkRecs, PPM, 44);
    return { seed: o.seed, policy: 'terrain', endReason: 'generated', distM: maxM, bands, generatedToM: maxM };
  }

  window.__sim = { run, genTerrain };
})();
