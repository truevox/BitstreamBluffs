/*
 * Page-side W3 biome scenarios for `node tools/sim/shots.mjs biomes <outDir>` (plain script, loaded
 * after shots-page.js). Uses the real generator, the real RunScene and the real palette switch:
 *   w3-biome-<id>-<palette>  — a live run whose sector is inside each batch-1 biome
 *
 * Why this exists: a biome's whole job is to look and play differently, so "the JSON has a palette"
 * is not evidence. These shots are taken from a run whose generator is actually producing that
 * biome's terrain, and the scenario also reports which biome the generator claims the sector is -
 * so a shot that silently fell back to base terrain fails loudly instead of looking plausible.
 */
(() => {
  'use strict';
  const S = () => window.__shots;
  const BIOMES = [
    { bit: 1, id: 'debumont', seed: 'biome-debumont-1', sector: 3 },
    { bit: 2, id: 'garbage-dump-glacier', seed: 'biome-garbage-dump-glacier-0', sector: 3 },
    { bit: 4, id: 'pyramid-peak', seed: 'biome-pyramid-peak-0', sector: 2 },
    { bit: 8, id: 'underwater-mountain', seed: 'biome-underwater-mountain-0', sector: 2 },
    { bit: 16, id: 'crystal-cavern', seed: 'biome-crystal-cavern-0', sector: 2 },
  ];

  async function ctx() {
    const M = await S().loadMods();
    const con = await import('/src/constants.js');
    const game = window.__bbGame;
    return { M, game, REG: con.REG };
  }

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
  function step(env, n = 1) { for (let i = 0; i < n; i++) S().frame(env, true); }
  async function palette(env, c, name) {
    const { updateSetting, createServices } = await import('/src/services.js');
    try { await createServices(env.game); } catch (e) { /* already booted */ }
    updateSetting(env.game, 'palette', name);
    step(env, 6);
    await new Promise((r) => setTimeout(r, 80));
  }

  /**
   * Run far enough that the generator is inside the biome, then shoot.
   * Distance is driven by the run itself (a hop policy), not by teleporting the camera: the terrain
   * must be genuinely generated at that sector or the shot proves nothing.
   */
  async function shootBiome(c, b, paletteName) {
    const { game, REG } = c;
    game.loop.stop();
    // Palette first, then boot the run into it. Switching mid-run left the NEXT shot reading a dead
    // scene (sled null, isActive false) - only ever the second frame of a pair.
    const { updateSetting, createServices } = await import('/src/services.js');
    try { await createServices(game); } catch (e) { /* already booted */ }
    updateSetting(game, 'palette', paletteName);
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    // Settle between shots: a stopped scene can still be tearing down its Matter world, and the next
    // shot then reads a null sled (this is exactly how the debumont colourblind frame first came back
    // at sector 0 - a silently failed shot, which is the failure mode this scenario exists to expose).
    await new Promise((r) => setTimeout(r, 250));
    const env = mkEnv(game);
    game.registry.set(REG.SEED, b.seed);
    game.registry.set(REG.LAST_RECORD, null);
    game.registry.set(REG.BIOME_MASK, b.bit);
    game.scene.start('RunScene', { seed: b.seed, dailyRuleId: 'none' });
    step(env, 8);
    game.events.emit(c.M.EVT.RUN_START, { seed: b.seed });

    // Advance the real scene until the player is inside biome terrain (sector 2+ is where biomes start).
    const scene = game.scene.getScene('RunScene');
    const tg = await import('/src/systems/TerrainGenerator.js');
    let sector = 0;
    let biome = null;
    // Read the same two things the scene itself reads (terrain._sectorOf(sled.x) and biomeForSector),
    // so this cannot report a biome the scene would disagree about.
    const read = () => {
      try {
        if (!scene || !scene.sled || !scene.terrain) return;
        sector = scene.terrain._sectorOf(scene.sled.x);
        const defs = Object.values((scene.content && scene.content.biomes) || {});
        biome = scene.biomeMask ? tg.biomeForSector(scene.seed, sector - 1, scene.biomeMask, defs) : null;
      } catch (e) { /* scene not ready yet */ }
    };
    // A run cannot reach sector 2 (~1 km) inside a screenshot budget, so place the sled at the START of
    // the biome's sector and let the real generator stream the terrain around it. The sled is moved, the
    // terrain is not: every chunk here is produced by the same code a player's run uses, which is the
    // only thing that makes the shot evidence.
    const { SECTOR_M } = tg;
    try {
      // sector is 1-based for display; terrain x is metres * PIXELS_PER_METER, so use the same
      // conversion the scene does rather than guessing a pixel scale.
      scene.sled.y = scene.sled.y || 0;
    } catch (e) { /* ignore */ }
    // Physics integrates the sled from vx/startX, so a single teleport is unwound on the next frame
    // (the probe caught it being dragged back to x=145). Pin it every frame instead, and move startX
    // with it so distance/sector accounting follows the sled rather than reporting 0 m.
    const { PIXELS_PER_METER: PPM } = await import('/src/constants.js');
    const targetX = (b.sector + 0.25) * SECTOR_M * PPM;
    const pin = () => {
      try {
        if (!scene || !scene.sled || !scene.terrain) return;
        // Stream the terrain AROUND the target first. Without this the sled is standing over a sector
        // that has never been generated, the height lookup fails and the scene respawns it back at the
        // start (the probe saw it pinned at x=223 with sector 1).
        scene.streamTerrain(targetX);
        const gy = scene.terrain.heightAt(targetX);
        // Sled is a Matter body: assigning .x moves the sprite, not the body, and the next physics
        // step snaps it back. setPose() is the real API (it converts origin -> COM itself).
        if (Number.isFinite(gy)) scene.sled.setPose(targetX, gy - 15, scene.slopeAt(targetX), 40, 0);
        scene.startX = targetX - (b.sector * SECTOR_M) * PPM;
      } catch (e) { /* ignore */ }
    };
    for (let i = 0; i < 40; i++) { pin(); step(env, 1); read(); }
    // settle: a few frames with no input so the sled is not mid-trick in the shot
    for (let i = 0; i < 10; i++) { pin(); env.pad.push = false; step(env, 1); read(); }
    if (!biome) {
      // Position did not take (scene still initialising): re-read once after settling.
      for (let i = 0; i < 20; i++) { pin(); step(env, 1); read(); }
    }
    step(env, 3);
    if (biome !== b.id) {
      for (let i = 0; i < 20; i++) { pin(); step(env, 1); read(); }
    }
    const meta = { biome: biome || null, sector, mask: b.bit, sledX: scene.sled ? Math.round(scene.sled.x) : null };
    await window.__shot(`w3-biome-${b.id}-${paletteName}`, meta);
    return meta;
  }

  async function run() {
    const c = await ctx();
    const out = {};
    for (const b of BIOMES) {
      out[b.id] = {
        default: await shootBiome(c, b, 'default'),
        colorblind: await shootBiome(c, b, 'colorblind'),
      };
    }
    return out;
  }

  window.__shotsBiomes = { run };
})();
