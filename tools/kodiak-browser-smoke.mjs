/** Issue #47: racing Kodiaks in the REAL game (minified build). Bears shove the sled; they never crash it
 * (owner override 2026-11-21: playful snow-racing rivals).
 *
 *   GAME_URL=http://localhost:8293/ SHOT_DIR=/tmp/shots node tools/kodiak-browser-smoke.mjs
 *
 * For each of the three bear TYPES (seeds whose first encounter is that type), at Sync Level 6, in SAME and MIXED packs:
 *  - a rider that does nothing meets the pack: a bear that reaches the sled SHOVES it backward and up. Every shove is
 *    bounded, one per bear, and the sled keeps moving forward; no bear crashes the run;
 *  - a skilled rider (hops just before contact, divebombs off bear landings) is never crashed by a bear;
 *  - a screenshot of the bear on screen for review.
 * Also: at Sync Level 1 no bear ever appears; a Kodiak run replays exactly from its ghost tape at 30 and 120 Hz
 * (the shoves live in the fixed tick).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const shotDir = process.env.SHOT_DIR || null;
const SEEDS = { kernelPanic: 'BEAR0', bruteForce: 'BEAR5', blackIce: 'BEAR4' };
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const MAX_SHOVE_PX = 220; // KODIAK_KNOCK.maxPx: the backward shove bound (px/s)

/** Start a run held at tick 0 with the sled already 450 m in, then step frames at `hz`. */
async function drive(page, { seed, level = 6, hz = 60, maxMs = 14000, shotWhen = null, hopOnTele = false, tape = null, mode = 'same' }) {
  return page.evaluate(async ({ seed, level, hz, maxMs, shotWhen, hopOnTele, tape, mode }) => {
    const g = window.__bbGame;
    const prof = g.registry.get('profile');
    if (prof) prof.level = level;
    const settings = g.registry.get('settings');
    if (settings) settings.kodiakPacks = mode;
    const run = g.scene.getScene('RunScene');
    if (!run.__real) run.__real = run.update;
    let hold = true;
    run.update = function (t, d) { if (!hold) return run.__real.call(this, t, d); };
    if (tape) g.registry.set('ghostReplay', tape);
    g.scene.getScene('TitleScene').startRun(seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
    g.loop.sleep();
    // 450 m of credit before tick 1 (identically in every run): the first encounter is due at once.
    run.startX = run.sled.x - 450 * 30 - 1;
    const events = [];
    const onK = (p) => events.push({ ...p, tick: run.simClock.tick, vxAfter: run.sled.vx });
    g.events.on('bb:kodiak', onK);
    // Counterplay probe, like a skilled player: hop (held for a full-height hop) just before a bear would
    // reach the sled; against a Black-Ice sliding under the landing, divebomb so the sled lands short of it.
    let hopHold = 0;
    run.inputRouter.poll = () => {
      const pad = { push: false, tilt: 0, hop: false, divebomb: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
      if (!hopOnTele) return pad;
      const s = run.sled;
      if (hopHold > 0) { hopHold--; pad.hop = true; }
      else if (s.grounded) {
        for (const b of run.kodiaks || []) {
          if (b.done || b.hit) continue;
          const gap = Math.abs(b.x - s.x) - 39; // box half-widths 21 + 18
          const closing = b.x > s.x ? s.vx - b.speed : b.speed - s.vx;
          if (gap < 4 || (closing > 0 && gap / closing < 0.16)) { pad.hop = true; pad.pressed.hop = true; hopHold = 18; break; }
        }
      }
      // In the air: if the landing would come down on a bear (a Black-Ice sliding under it, or any bear where the
      // sled will land), divebomb to land short of it.
      if (!s.grounded && Number.isFinite(s.airEtaMs)) {
        const eta = s.airEtaMs / 1000, landX = s.x + s.vx * eta;
        const onBear = (run.kodiaks || []).some((b) => !b.done && !b.hit &&
          (b.kind === 'blackIce' && b.phase === 'tele' || Math.abs(landX - (b.x + b.speed * eta)) < 60));
        if (onBear) pad.divebomb = true;
      }
      return pad;
    };
    hold = false;
    let t = 0, shot = null;
    const tickMs = run.simClock.tickMs;
    while (!run.crashed && run.simClock.tick * tickMs < maxMs) {
      t += 1000 / hz;
      g.step(t, 1000 / hz);
      if (window.__trace) window.__trace.push([run.simClock.tick, Math.round(run.sled.x), Math.round(run.sled.y), run.sled.grounded ? 'G' : 'A', Math.round(run.sled.vx),
        ...(run.kodiaks || []).map((b) => `${b.kind[0]}${b.member}:${b.phase}:${Math.round(b.x - run.sled.x)}:${Math.round(b.speed)}:${b.hit ? 'HIT' : ''}${b.done ? 'D' : ''}:${Math.round(b.groundY)}`)].join(' '));
      const v = run._view;
      const onScreen = (run.kodiaks || []).filter((b) => !b.done && v && b.x > v.left + 40 && b.x < v.right - 40);
      if (shotWhen && !shot && onScreen.length >= (shotWhen === 'pack' ? 2 : 1) &&
          (shotWhen === 'visible' || shotWhen === 'pack' || onScreen.some((b) => b.phase === shotWhen))) {
        shot = { tick: run.simClock.tick, onScreen: onScreen.map((b) => b.kind + ':' + b.phase) }; break;
      }
    }
    if (run.crashed) await new Promise((r) => setTimeout(r, 400));
    g.events.off('bb:kodiak', onK);
    const crash = g.registry.get('lastCrash');
    const firstShove = events.find((e) => e.type === 'shove');
    return { events, crashed: !!run.crashed, killer: crash?.name || null, crashLine: crash?.line || null, crashCause: crash?.cause || null,
      tape: g.registry.get('lastGhostTape') || null, shot, kodiaksOn: run.kodiaksOn,
      ticksAfterShove: firstShove ? run.simClock.tick - firstShove.tick : null,
      replay: run.tapePlayer ? { desync: run.tapePlayer.desync, checked: run.tapePlayer.checked } : null, tick: run.simClock.tick };
  }, { seed, level, hz, maxMs, shotWhen, hopOnTele, tape, mode });
}

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
  return { p, errors };
}

const browser = await chromium.launch({ headless: true, args: ARGS });
const summary = [];
try {
  for (const mode of ['same', 'mixed']) {
    for (const [kind, seed] of Object.entries(SEEDS)) {
      // Passive: a rider that does nothing. The pack warns; a bear that reaches the sled shoves it, and no bear crashes it.
      const a = await page(browser);
      const r = await drive(a.p, { seed, mode });
      const shoves = r.events.filter((e) => e.type === 'shove');
      const types = r.events.map((e) => e.type);
      assert.equal(r.events[0]?.type, 'incoming', `${mode}/${kind}: no incoming warning`);
      assert.equal(r.events[0].mode, mode);
      assert.equal(r.events[0].members.length >= 2, true, `${mode}/${kind}: not a pack`);
      if (mode === 'same') assert.equal(new Set(r.events[0].members).size, 1, 'same-type pack mixed types');
      else assert.ok(new Set(r.events[0].members).size >= 2, 'mixed pack has one type');
      assert.doesNotMatch(String(r.killer || ''), /KODIAK/, `${mode}/${kind}: a bear crashed the sled (${r.killer})`);
      assert.ok(shoves.length > 0 || types.includes('passed') || types.includes('gone'), `${mode}/${kind}: the pack did nothing`);
      if (kind !== 'blackIce') assert.ok(shoves.length > 0, `${mode}/${kind}: a rider that does nothing was never shoved`);
      for (const e of shoves) {
        assert.ok(e.dvx < 0 && e.dvy < 0, `${mode}/${kind}: a shove is not backward and up (${e.dvx}, ${e.dvy})`);
        assert.ok(-e.dvx <= MAX_SHOVE_PX, `${mode}/${kind}: a shove exceeds the bound (${-e.dvx} px/s)`);
        assert.ok(e.vxAfter > 0, `${mode}/${kind}: a shove stopped the sled dead`);
      }
      const keys = shoves.map((e) => `${e.n}/${e.member}`);
      assert.equal(new Set(keys).size, keys.length, `${mode}/${kind}: a bear shoved twice (${keys})`);
      if (shoves.length) console.log('KODIAK_SHOVE', mode, kind, JSON.stringify({ shoves: shoves.length, ticksAfterShove: r.ticksAfterShove, crashed: r.crashed, killer: r.killer }));
      assert.deepEqual(a.errors, []);
      await a.p.close();
      // Counterplay: hop on every telegraph; a skilled rider is never crashed by a bear.
      const c = await page(browser);
      const cr = await drive(c.p, { seed, mode, hopOnTele: true });
      const crashedByBear = cr.crashed && /KODIAK/.test(String(cr.killer || ''));
      summary.push({ mode, lead: kind, members: r.events[0].members, passive: shoves.length ? `shoved x${shoves.length}` : 'not shoved',
        skilled: cr.crashed ? `crashed: ${cr.killer}` : 'not crashed', skilledShoves: cr.events.filter((e) => e.type === 'shove').length,
        passes: cr.events.filter((e) => e.type === 'passed').length });
      assert.equal(crashedByBear, false, `${mode}/${kind}: a skilled rider was crashed by ${cr.killer}`);
      await c.p.close();
      if (shotDir && (mode === 'same' || kind === 'bruteForce')) {
        const sp = await page(browser);
        // Two Kernel-Panics ride ahead together; a grizzly or Black-Ice is shot when one is on screen.
        const shot = await drive(sp.p, { seed, mode, shotWhen: kind === 'kernelPanic' && mode === 'same' ? 'pack' : 'visible', hopOnTele: true, maxMs: 20000 });
        await sp.p.evaluate(() => window.__bbGame.step(performance.now(), 16.7));
        await sp.p.screenshot({ path: `${shotDir}/kodiak-${mode}-${kind}.png` });
        console.log('KODIAK_SHOT', mode, kind, JSON.stringify(shot.shot));
        await sp.p.close();
      }
    }
  }
  console.log('KODIAK_COUNTERPLAY', JSON.stringify(summary, null, 1));
  // Level gate
  const low = await page(browser);
  const lr = await drive(low.p, { seed: SEEDS.bruteForce, level: 1, maxMs: 6000 });
  assert.equal(lr.kodiaksOn, false);
  assert.deepEqual(lr.events, [], 'a bear appeared below the Sync Level gate');
  console.log('KODIAK_LEVEL_GATE_PASS');
  await low.p.close();
  // Determinism: a pack run with shoves replays exactly from its tape at 30 and 120 Hz.
  const rec = await page(browser);
  const recorded = await drive(rec.p, { seed: SEEDS.bruteForce, mode: 'mixed' });
  await rec.p.close();
  assert.ok(recorded.tape, 'no tape from the recorded pack run');
  for (const hz of [30, 120]) {
    const rp = await page(browser);
    const r = await drive(rp.p, { seed: SEEDS.bruteForce, hz, tape: recorded.tape, mode: 'same' }); // header wins
    assert.equal(r.replay.desync, null, `${hz} Hz Kodiak replay desynced`);
    assert.equal(r.tick, recorded.tick, `${hz} Hz replay ended on tick ${r.tick}, recording on ${recorded.tick}`);
    console.log('KODIAK_REPLAY_PASS', hz, JSON.stringify({ checked: r.replay.checked, tick: r.tick }));
    await rp.p.close();
  }
} finally { await browser.close(); }
