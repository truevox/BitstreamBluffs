/*
 * Page-side W1 progression scenarios for `node tools/sim/shots.mjs progression <outDir> [opts]` (plain script,
 * loaded after shots-page.js). Uses the real services + real scenes:
 *   title      — TitleScene with the SYNC LEVEL badge, default and colorblind palettes
 *   profile    — the PROFILE view (lifetime stats), default and colorblind
 *   gameover   — GameOverScene after a credited run: Resonance bar, no level-up, default and colorblind
 *   levelup    — GameOverScene after a run that levels up: SYNC LEVEL n + what unlocked, default and colorblind
 *   initials   — GameOverScene with the initials entry OPEN (footer hint at its longest), both palettes
 * Every shot is driven by real RUN_END → ProgressionService, not by faking the registry.
 */
(() => {
  'use strict';
  const S = () => window.__shots;

  /** Boot services if needed and return the module handles the scenarios need. */
  async function ctx() {
    const M = await S().loadMods();
    const [{ createServices, updateSetting }, prof, con] = await Promise.all([
      import('/src/services.js'),
      import('/src/systems/Progression.js'),
      import('/src/constants.js'),
    ]);
    const game = window.__bbGame;
    // Reset any profile left over from another scenario: these shots must be reproducible.
    try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
    game.registry.set('profile', null);
    game.registry.set('lastAwards', null);
    game.registry.set('lastRecord', null);
    await createServices(game);
    const svc = game.registry.get(con.REG.PROGRESSION);
    if (svc) { svc.destroy(); await svc.init(); }
    return { M, game, createServices, updateSetting, prof, REG: con.REG, svc };
  }

  /** A frame-driver env with the shape shots-page.frame() expects (it clears pad.hop every step). */
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

  /** Advance n rendered frames so Phaser actually draws the current state. */
  function step(env, n = 1) {
    for (let i = 0; i < n; i++) S().frame(env, true);
  }

  /** Switch palette and let every Theme callback repaint before the shot. */
  async function palette(env, c, name) {
    c.updateSetting(env.game, 'palette', name);
    step(env, 6);
    await new Promise((r) => setTimeout(r, 80));
  }

  /** A RunRecord good enough for crediting (mirrors what RunScene emits on RUN_END). */
  function record(over) {
    return {
      id: `shot-${over.tag || 'a'}`, seed: 'sim-shots', dailyRuleId: 'none', startedAt: Date.now(),
      endedAt: Date.now(), durationMs: 95000, score: 7400, distanceM: 1850, trickPoints: 620,
      tricks: { backflip: 3, frontflip: 1, spin360: 2 }, bestCombo: 3, bestFlow: 2.5, maxAirtimeMs: 2100,
      cause: 'crash', ledgerHash: `hash-${over.tag || 'a'}`, shards: 9, nearMisses: 6, bonusPoints: 120,
      ...over,
    };
  }

  /** Drive the real TitleScene and shoot it. */
  async function title(o) {
    const c = await ctx();
    const { game } = c;
    const out = {};
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    const audio = game.registry.get(c.REG.AUDIO);
    if (audio) for (const k of ['playSfx', 'glitch', 'setSpeed', 'setIntensity', 'startMusic', 'stopMusic', 'duckMusic', 'unlock']) audio[k] = () => {};
    const env = mkEnv(game);
    game.scene.start('TitleScene');
    step(env, 40);
    await palette(env, c, 'default');
    await window.__shot('w1-title-badge-default', { level: (game.registry.get(c.REG.PROFILE) || {}).level });
    await palette(env, c, 'colorblind');
    await window.__shot('w1-title-badge-colorblind', { level: (game.registry.get(c.REG.PROFILE) || {}).level });
    await palette(env, c, 'default');
    out.title = { level: (game.registry.get(c.REG.PROFILE) || {}).level };
    return out;
  }

  /** Open the PROFILE view on the real TitleScene and shoot it. */
  async function profile(o) {
    const c = await ctx();
    const { game } = c;
    const out = {};
    const env = mkEnv(game);
    // Stop every other scene first: the initials scenario leaves GameOverScene running, and a live
    // scene above TitleScene means the ProfileView is drawn underneath it and never appears in the shot.
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    game.scene.start('TitleScene');
    step(env, 40);
    const ts = game.scene.getScene('TitleScene');
    const { ProfileView } = await import('/src/ui/Views.js');
    const { Theme } = await import('/src/ui/Theme.js');
    const theme = ts.theme || new Theme(ts);
    ts._openView(new ProfileView(ts, theme, { onClose: () => ts._closeView() }));
    step(env, 12);
    await palette(env, c, 'default');
    await window.__shot('w1-profile-view-default', {});
    await palette(env, c, 'colorblind');
    await window.__shot('w1-profile-view-colorblind', {});
    await palette(env, c, 'default');
    const active = game.scene.scenes.filter((sc) => sc.scene.isActive() || sc.scene.isVisible()).map((sc) => sc.scene.key);
    out.profile = { open: Boolean(ts.view), active };
    return out;
  }

  /** Emit a real RUN_END, then start GameOverScene and shoot the Resonance row. */
  async function gameover(o, opts = {}) {
    const c = await ctx();
    const { game, M } = c;
    const rec = record({ tag: opts.tag || 'a', ...(opts.record || {}) });
    game.registry.set(c.REG.SEED, rec.seed);
    game.registry.set(c.REG.LAST_RECORD, rec);
    game.events.emit(M.EVT.RUN_END, { record: rec });
    const awards = game.registry.get(c.REG.LAST_AWARDS) || null;
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    const env = mkEnv(game);
    game.scene.start('GameOverScene');
    step(env, 30);
    await palette(env, c, 'default');
    await window.__shot(`w1-gameover-${opts.name || 'resonance'}-default`, { xp: awards && awards.xp.total, leveledTo: awards && awards.leveledTo });
    await palette(env, c, 'colorblind');
    await window.__shot(`w1-gameover-${opts.name || 'resonance'}-colorblind`, { xp: awards && awards.xp.total, leveledTo: awards && awards.leveledTo });
    await palette(env, c, 'default');
    return { xp: awards && awards.xp.total, leveledTo: awards && awards.leveledTo, progress: awards && awards.progress };
  }

  /**
   * Game Over with the initials entry open. CC Friday's PR #17 verification found the footer hint
   * ("TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY") drawn across the Resonance bar, and noted the
   * shots never covered this state — which is why the layout probe passed. This scenario is the
   * missing coverage: the entry needs a real top-10 qualification, so it seeds a leaderboard first.
   */
  async function initials(o) {
    const c = await ctx();
    const { game, M, REG } = c;
    const rec = record({ tag: 'ini', score: 90000, distanceM: 4200 });
    game.registry.set(REG.SEED, rec.seed);
    game.registry.set(REG.LAST_RECORD, rec);
    // Three existing entries make `worthy` true, and a high score makes qualifiesForTop10 true.
    const store = game.registry.get(REG.SAVE_STORE);
    if (store && typeof store.getLeaderboard === 'function') {
      store.getLeaderboard = async () => [
        { id: 'x1', initials: 'AAA', score: 1000, distanceM: 100, seed: 's1', dailyRuleId: 'none' },
        { id: 'x2', initials: 'BBB', score: 900, distanceM: 90, seed: 's2', dailyRuleId: 'none' },
        { id: 'x3', initials: 'CCC', score: 800, distanceM: 80, seed: 's3', dailyRuleId: 'none' },
      ];
      store.qualifiesForTop10 = async () => true;
    }
    game.events.emit(M.EVT.RUN_END, { record: rec });
    const awards = game.registry.get(REG.LAST_AWARDS) || null;
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    const env = mkEnv(game);
    game.scene.start('GameOverScene');
    step(env, 30);
    // The async leaderboard promise resolves on a microtask; give it a real frame to open the entry.
    await new Promise((r) => setTimeout(r, 200));
    step(env, 20);
    const scene = game.scene.getScene('GameOverScene');
    const open = !!(scene && scene.entry);
    await palette(env, c, 'default');
    await window.__shot('w1-gameover-initials-default', { entryOpen: open, xp: awards && awards.xp.total });
    await palette(env, c, 'colorblind');
    await window.__shot('w1-gameover-initials-colorblind', { entryOpen: open, xp: awards && awards.xp.total });
    await palette(env, c, 'default');
    return { entryOpen: open, footer: scene && scene.footer && scene.footer.text };
  }

  // A normal credited run, then a run big enough to level up from a fresh profile.
  async function run(o) {
    const out = {};
    out.resonance = await gameover(o, { name: 'resonance', tag: 'r1' });
    // Level-up: a long clean run on the same profile so the crossing is earned, not faked.
    out.levelup = await gameover(o, {
      name: 'levelup', tag: 'r2',
      record: { distanceM: 9500, score: 32000, trickPoints: 4200, tricks: { backflip: 14, spin360: 9 }, shards: 70, nearMisses: 22, durationMs: 240000 },
    });
    out.title = (await title(o)).title;
    out.initials = await initials(o);
    out.profile = (await profile(o)).profile;
    return out;
  }
  window.__shotsProgression = { run, title, profile, gameover, initials };
})();
