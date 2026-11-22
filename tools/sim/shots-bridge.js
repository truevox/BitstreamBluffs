/*
 * Page-side #65 presentation scenarios for `node tools/sim/shots.mjs bridge <outDir> '<json opts>'` (plain script, loaded
 * after shots-page.js). Uses the real generator, the real RunScene and the real palette switch.
 *
 * opts: { seed, mask, tag, reduced, shots: [{ name, kind: 'start'|'frac'|'m', frac?, m? }] }
 *   start  the run as it opens (Debutmont, no teleport)
 *   frac   a fraction f (0..1) of the first arcade bridge that follows the run's first biome change
 *   m      a fixed distance in metres (inside a biome)
 * The bridge span is found by scanning terrain.biomeAtX (not the new bridgeSpanAt), so the same script also runs against
 * the code before #65 part 3 for the before/after pairs. The sled is pinned to each position every frame and the terrain
 * is the generator's own, streamed around it (the same technique as shots-biomes.js).
 */
(() => {
  'use strict';
  const S = () => window.__shots;

  function mkEnv(game) {
    return {
      game, t: 0, scene: null, hints: [],
      pad: {
        push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
        parachute: false, pause: false, lastSource: 'keyboard',
        pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
      },
    };
  }
  const step = (env, n = 1) => { for (let i = 0; i < n; i++) S().frame(env, true); };

  async function run(o) {
    const seed = o.seed || 'shots65-d';
    const mask = o.mask == null ? 2 : o.mask;
    const M = await S().loadMods();
    const con = await import('/src/constants.js');
    const tg = await import('/src/systems/TerrainGenerator.js');
    const { updateSetting, createServices } = await import('/src/services.js');
    try { const cr = await import('/src/systems/CosmeticRandom.js'); cr.seedCosmeticRandom(65); } catch (e) { /* older tree */ }
    const game = window.__bbGame;
    game.loop.stop();
    try { await createServices(game); } catch (e) { /* already booted */ }
    updateSetting(game, 'palette', 'default');
    updateSetting(game, 'reduceMotion', o.reduced ? 'on' : 'off');
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    await new Promise((r) => setTimeout(r, 250));
    const env = mkEnv(game);
    game.registry.set(con.REG.SEED, seed);
    game.registry.set(con.REG.LAST_RECORD, null);
    game.registry.set(con.REG.BIOME_MASK, mask);
    game.scene.start('RunScene', { seed, dailyRuleId: 'none' });
    step(env, 8);
    game.events.emit(M.EVT.RUN_START, { seed });
    const scene = game.scene.getScene('RunScene');
    const PPM = con.PIXELS_PER_METER;

    // first bridge after the first biome change: scan biomeAtX in 10 px steps (scratch only)
    const ter = scene.terrain;
    let bridge = null;
    {
      let prev = ter.biomeAtX(0);
      let a = null;
      for (let x = 0; x < 90000 && !bridge; x += 10) {
        const id = ter.biomeAtX(x);
        if (id === null && prev !== null) a = x;
        if (id !== null && prev === null && a !== null) bridge = { startX: a, endX: x, from: ter.biomeAtX(a - 10), to: id };
        prev = id;
      }
    }
    const meta = { seed, mask, reduced: !!o.reduced, bridge: bridge && { startM: Math.round(bridge.startX / PPM), endM: Math.round(bridge.endX / PPM), from: bridge.from, to: bridge.to } };

    let targetX = null;
    const pin = () => {
      if (targetX == null || !scene.sled || !scene.terrain) return;
      scene.streamTerrain(targetX);
      const gy = scene.terrain.heightAt(targetX);
      if (Number.isFinite(gy)) scene.sled.setPose(targetX, gy - 15, scene.slopeAt(targetX), 40, 0);
      scene.startX = targetX - 1000 * PPM;
      scene.sled.invulnerableMs = 1e9; // a pinned sled is a camera, not a rider: no hazard may end the shot
    };
    const shots = [];
    for (const sh of o.shots) {
      if (sh.kind === 'start') {
        targetX = null;
        step(env, sh.frames || 90);
      } else {
        targetX = sh.kind === 'frac' ? bridge.startX + sh.frac * (bridge.endX - bridge.startX) : sh.m * PPM;
        // walk the sled up to the spot a little at a time so the look follows it through the bridge the way a run would
        const from = scene.sled ? scene.sled.x : 0;
        const stepsN = 60;
        for (let i = 1; i <= stepsN; i++) { const keep = targetX; targetX = from + (keep - from) * (i / stepsN); pin(); step(env, 1); targetX = keep; }
        for (let i = 0; i < 20; i++) { pin(); step(env, 1); }
      }
      const info = {
        name: sh.name, sledXm: scene.sled ? Math.round(scene.sled.x / PPM) : null,
        biome: scene.terrain.biomeAtX(scene.sled.x), crashed: !!scene.crashed, t: Math.round(scene.runTimeMs), look: scene._lookId === undefined ? '(n/a)' : scene._lookId, veil: scene._veil,
        frac: bridge ? +((scene.sled.x - bridge.startX) / (bridge.endX - bridge.startX)).toFixed(3) : null,
      };
      await window.__shot(`${o.tag || 'shot'}-${sh.name}`, { ...info });
      shots.push(info);
    }
    // optional: CPU cost of BiomeFx.update (JS side only; the GPU is software here) in each state, ms per call
    let perf = null;
    if (o.perf && scene.biomeFx) {
      const fx = scene.biomeFx;
      const time = (label, look, veil) => {
        fx.setLook(look);
        for (let i = 0; i < 60; i++) fx.update(i * 10, i * 16, veil, false);
        const t0 = performance.now();
        const N = 600;
        for (let i = 0; i < N; i++) fx.update(i * 10, 4000 + i * 16, veil, false);
        return [label, +((performance.now() - t0) / N).toFixed(4)];
      };
      perf = Object.fromEntries([time('debutmont', 'debutmont', 0), time('glacier', 'garbage-dump-glacier', 0), time('veil-half', 'debutmont', 0.5), time('veil-full', null, 1), time('other-biome', 'pyramid-peak', 0)]);
    }
    return { meta, shots, perf };
  }
  window.__shotsBridge = { run };
})();
