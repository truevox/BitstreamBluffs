/*
 * Page-side W2 mission scenarios for `node tools/sim/shots.mjs missions <outDir>` (plain script,
 * loaded after shots-page.js). Mirrors shots-progression.js exactly: real services, real scenes,
 * real palette switches — nothing is faked into the registry.
 *   title    — TitleScene with the three active missions under the DAILY PATCH strip
 *   pause    — PauseScene with the mission column (default + colorblind)
 *   gameover — GameOverScene after a credited run, showing mission progress
 */
(() => {
  'use strict';
  const S = () => window.__shots;

  /** Boot services and return the module handles these scenarios need. */
  async function ctx() {
    const M = await S().loadMods();
    const [{ createServices, updateSetting }, con] = await Promise.all([
      import('/src/services.js'),
      import('/src/constants.js'),
    ]);
    const game = window.__bbGame;
    try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
    game.registry.set('profile', null);
    game.registry.set('lastAwards', null);
    game.registry.set('lastRecord', null);
    await createServices(game);
    const prog = game.registry.get(con.REG.PROGRESSION);
    if (prog) { prog.destroy(); await prog.init(); }
    const missions = game.registry.get(con.REG.MISSIONS_SERVICE);
    if (missions) { missions.destroy(); await missions.init(); if (prog) prog.missions = missions; }
    return { M, game, createServices, updateSetting, REG: con.REG, EVT: M.EVT, missions, prog };
  }

  /** Frame-driver env with the shape shots-page.frame() expects. */
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

  function step(env, n = 1) {
    for (let i = 0; i < n; i++) S().frame(env, true);
  }

  async function palette(env, c, name) {
    c.updateSetting(env.game, 'palette', name);
    step(env, 6);
    await new Promise((r) => setTimeout(r, 80));
  }

  /** A RunRecord shaped like what RunScene emits on RUN_END. */
  function record(over) {
    return {
      id: `shot-${over.tag || 'a'}`, seed: 'sim-shots', dailyRuleId: 'none', startedAt: Date.now(),
      endedAt: Date.now(), durationMs: 95000, score: 7400, distanceM: 1850, trickPoints: 620,
      tricks: { backflip: 3, frontflip: 1, spin360: 2 }, bestCombo: 3, bestFlow: 2.5, maxAirtimeMs: 2100,
      cause: 'crash', ledgerHash: `hash-${over.tag || 'a'}`, shards: 62, nearMisses: 14, bonusPoints: 120,
      ...over,
    };
  }

  /** Silence audio so headless runs do not warn. */
  function muteAudio(game, REG) {
    const audio = game.registry.get(REG.AUDIO);
    if (audio) for (const k of ['playSfx', 'glitch', 'setSpeed', 'setIntensity', 'startMusic', 'stopMusic', 'duckMusic', 'unlock']) audio[k] = () => {};
  }

  /** Title screen with the mission list. */
  async function title() {
    const c = await ctx();
    const { game, REG } = c;
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    muteAudio(game, REG);
    const env = mkEnv(game);
    game.scene.start('TitleScene');
    step(env, 40);
    await palette(env, c, 'default');
    const view = game.registry.get(REG.MISSIONS);
    await window.__shot('w2-title-missions-default', { active: view ? view.active.length : 0 });
    await palette(env, c, 'colorblind');
    await window.__shot('w2-title-missions-colorblind', { active: view ? view.active.length : 0 });
    await palette(env, c, 'default');
    return { active: view ? view.active.length : 0 };
  }

  /** Pause panel with the mission column. */
  async function pause() {
    const c = await ctx();
    const { game, REG } = c;
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    muteAudio(game, REG);
    const env = mkEnv(game);
    game.registry.set(REG.SEED, 'sim-shots');
    game.scene.start('PauseScene', { runTimeMs: 63000, runId: 'shot-a' });
    step(env, 30);
    await palette(env, c, 'default');
    const view = game.registry.get(REG.MISSIONS);
    await window.__shot('w2-pause-missions-default', { active: view ? view.active.length : 0 });
    await palette(env, c, 'colorblind');
    await window.__shot('w2-pause-missions-colorblind', { active: view ? view.active.length : 0 });
    await palette(env, c, 'default');
    try { game.scene.stop('PauseScene'); } catch (e) { /* ignore */ }
    return { active: view ? view.active.length : 0 };
  }

  /** Game Over after a credited run, showing mission progress. */
  async function gameover(opts = {}) {
    const c = await ctx();
    const { game, REG, EVT } = c;
    game.loop.stop();
    const rec = record({ tag: opts.tag || 'a', ...(opts.record || {}) });
    game.registry.set(REG.SEED, rec.seed);
    game.registry.set(REG.LAST_RECORD, rec);
    game.events.emit(EVT.RUN_END, { record: rec });
    const awards = game.registry.get(REG.LAST_AWARDS) || null;
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    muteAudio(game, REG);
    const env = mkEnv(game);
    game.scene.start('GameOverScene');
    step(env, 40);
    await palette(env, c, 'default');
    const meta = {
      completed: awards && awards.missions ? awards.missions.completed.length : 0,
      xp: awards && awards.xp ? awards.xp.total : 0,
    };
    await window.__shot('w2-gameover-missions-default', meta);
    await palette(env, c, 'colorblind');
    await window.__shot('w2-gameover-missions-colorblind', meta);
    await palette(env, c, 'default');
    return meta;
  }

  /**
   * Game Over with the initials entry OPEN. This is the state CC Friday found unreadable at native
   * resolution ("MISSIONS header flush under the SPACE = SAVE + RETRY hint", mission rows sliced), and
   * it is the state the old probe never captured: the entry needs a real top-10 qualification, so this
   * seeds a leaderboard and a score that qualifies. Without this shot the probe can pass while the
   * panel is unreadable in the one state a new player actually sees on their first good run.
   */
  async function gameoverInitials(opts = {}) {
    const c = await ctx();
    const { game, REG, EVT } = c;
    game.loop.stop();
    const rec = record({ tag: 'ini', score: 90000, distanceM: 4200, ...(opts.record || {}) });
    game.registry.set(REG.SEED, rec.seed);
    game.registry.set(REG.LAST_RECORD, rec);
    const store = game.registry.get(REG.SAVE_STORE);
    if (store && typeof store.getLeaderboard === 'function') {
      store.getLeaderboard = async () => [
        { id: 'x1', initials: 'AAA', score: 1000, distanceM: 100, seed: 's1', dailyRuleId: 'none' },
        { id: 'x2', initials: 'BBB', score: 900, distanceM: 90, seed: 's2', dailyRuleId: 'none' },
        { id: 'x3', initials: 'CCC', score: 800, distanceM: 80, seed: 's3', dailyRuleId: 'none' },
      ];
      store.qualifiesForTop10 = async () => true;
    }
    game.events.emit(EVT.RUN_END, { record: rec });
    const awards = game.registry.get(REG.LAST_AWARDS) || null;
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    muteAudio(game, REG);
    const env = mkEnv(game);
    game.scene.start('GameOverScene');
    step(env, 30);
    // The leaderboard promise resolves on a microtask; give it a real frame to open the entry.
    await new Promise((r) => setTimeout(r, 200));
    step(env, 20);
    const scene = game.scene.getScene('GameOverScene');
    const open = !!(scene && scene.entry);
    const meta = { entryOpen: open, footer: scene && scene.footer && scene.footer.text };
    await palette(env, c, 'default');
    await window.__shot('w2-gameover-initials-default', meta);
    await palette(env, c, 'colorblind');
    await window.__shot('w2-gameover-initials-colorblind', meta);
    await palette(env, c, 'default');
    return meta;
  }

  /** The mid-run completion toast on the real HUD (uses the MILESTONE strip). */
  async function toast() {
    const c = await ctx();
    const { game, REG, EVT } = c;
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    muteAudio(game, REG);
    const env = mkEnv(game);
    game.registry.set(REG.SEED, 'sim-shots');
    game.registry.set(REG.LAST_RECORD, null);
    game.scene.start('RunScene', { seed: 'sim-shots', dailyRuleId: 'none' });
    step(env, 10);
    game.events.emit(EVT.RUN_START, { seed: 'sim-shots' });
    // Drive a real completion event, which is what the service emits when a target is met.
    game.events.emit(EVT.MISSION_COMPLETED, { id: 't1-cum-shards-50', title: 'Collect 50 shards', xp: 60, shards: 4 });
    // Let the strip slide in, then shoot while it is on screen.
    step(env, 18);
    await palette(env, c, 'default');
    step(env, 6);
    await window.__shot('w2-toast-mission-default', {});
    await palette(env, c, 'colorblind');
    step(env, 6);
    await window.__shot('w2-toast-mission-colorblind', {});
    await palette(env, c, 'default');
    for (const k of ['RunScene', 'UIScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    return { ok: true };
  }

  async function run(o) {
    const out = {};
    out.title = await title(o);
    out.gameover = await gameover(o);
    out.gameoverInitials = await gameoverInitials(o);
    out.pause = await pause(o);
    out.toast = await toast(o);
    return out;
  }

  window.__shotsMissions = { run, title, pause, gameover, gameoverInitials, toast };
})();
