/*
 * Page-side probe for the W1 Title badge + PROFILE view (plain script, loaded after shots-page.js).
 *
 * Drives the REAL TitleScene and the REAL ProfileView, then reports for every visible NeonText:
 *   - its screen-space box (glyph ink: 7 cap rows, +1 when the text has a descender)
 *   - any character missing from the 5x7 font (PixelFont renders '?' for those)
 *   - every overlapping pair
 * The geometry model in src/ui/ProfileLayout.js is unit-tested; this proves the DRAWN result matches.
 *
 * The animated logo is excluded from the overlap pass on purpose (one NeonText per character, spaced by
 * design so the outline layers touch) and checked separately against the badge instead.
 *
 *   node tools/sim/shots.mjs probeTitle <outDir>
 *   node tools/sim/shots.mjs probeProfile <outDir>
 */
(() => {
  'use strict';
  const S = () => window.__shots;
  const shot = (name, meta) => (typeof window.__shot === 'function' ? window.__shot(name, meta) : Promise.resolve(null));
  const CAP_ROWS = 7; // the 5x7 font draws rows 0-6; row 7 is the descender row
  const DESCENDERS = /[gjpqy,;()]/; // the only glyphs that ink below the baseline

  /**
   * Characters the registered 5x7 bitmap font actually has, straight from Phaser's font cache
   * (data.chars is keyed by NUMERIC char code). Anything else is drawn as '?'.
   */
  function fontChars(game) {
    const entry = game.cache.bitmapFont.get('bb');
    const data = (entry && entry.data) || {};
    const codes = new Set(Object.keys(data.chars || {}));
    return (text) => [...new Set([...String(text)].filter((ch) => ch !== ' ' && !codes.has(String(ch.codePointAt(0)))))];
  }

  /** Walk a container tree and collect visible NeonText boxes in screen space. */
  function textBoxes(root, skip) {
    const out = [];
    const walk = (obj, ox, oy, alpha) => {
      if (!obj || obj.visible === false) return;
      const a = alpha * (obj.alpha === undefined ? 1 : obj.alpha);
      const x = ox + (obj.x || 0);
      const y = oy + (obj.y || 0);
      if (obj.main && obj.main.text !== undefined) {
        const t = String(obj.main.text);
        if (t && a > 0.08 && !(skip && skip.includes(obj))) {
          const sx = obj.scaleX || 1;
          const sy = obj.scaleY || 1;
          const w = obj.main.width * sx;
          const rows = CAP_ROWS + (DESCENDERS.test(t) ? 1 : 0);
          const h = rows * sy;
          out.push({
            text: t,
            alpha: Number(a.toFixed(2)),
            box: {
              x: Math.round(x - w * obj.main.originX),
              y: Math.round(y - h * obj.main.originY),
              w: Math.round(w),
              h: Math.round(h),
            },
          });
        }
      }
      if (obj.list) for (const c of obj.list) walk(c, x, y, a);
    };
    walk(root, 0, 0, 1);
    return out;
  }

  function overlaps(boxes) {
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i].box;
        const q = boxes[j].box;
        const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        if (ix > 0 && iy > 0) hits.push({ a: boxes[i].text, b: boxes[j].text, ix, iy });
      }
    }
    return hits;
  }

  const env = (game) => ({
    game, t: 0, scene: null, hints: [],
    pad: {
      push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
      parachute: false, pause: false, lastSource: 'keyboard',
      pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
    },
  });
  const step = (e, n) => { for (let i = 0; i < n; i++) S().frame(e, true); };

  async function bootTitle() {
    const M = await S().loadMods();
    const game = window.__bbGame;
    game.loop.stop();
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) {
      try { game.scene.stop(k); } catch (e) { /* ignore */ }
    }
    return { M, game };
  }

  /** Give the profile real numbers so no field renders as its empty default. */
  async function seedProfile(game) {
    const { defaultProfile } = await import('/src/systems/Progression.js');
    const p = defaultProfile();
    p.xp = 15850; // level 8/9 territory, so several biome rewards are reached
    p.lifetime = {
      runs: 42, distanceM: 98500, playMs: 4.2 * 3600 * 1000, score: 512000, tricks: { backflip: 120, spin360: 64 },
      shards: 310, nearMisses: 88, bestScore: 48210, bestDistanceM: 7310, bestCombo: 3.5, maxAirtimeMs: 4120,
    };
    p.pendingBiomes = ['debumont', 'garbage-dump-glacier'];
    game.registry.set('profile', p);
    return p;
  }

  /** Palette swap must repaint without moving or resizing anything. */
  async function paletteSwap(game, e, collect) {
    const { updateSetting } = await import('/src/services.js');
    const before = collect();
    updateSetting(game, 'palette', 'colorblind');
    step(e, 6);
    await new Promise((r) => setTimeout(r, 90));
    const after = collect();
    updateSetting(game, 'palette', 'default');
    step(e, 2);
    const key = (list) => JSON.stringify(list.map((b) => [b.text, b.box]));
    return { texts: after.length, geometryIdentical: key(before) === key(after) };
  }

  async function runTitle(o) {
    const { game } = await bootTitle();
    const p = await seedProfile(game);
    const check = fontChars(game);
    const e = env(game);
    game.scene.start('TitleScene');
    step(e, 30);
    const ts = game.scene.getScene('TitleScene');
    const logo = (ts.logo || []).map((l) => l.t);
    const collect = () => textBoxes(ts.children, logo);
    const boxes = collect();
    const report = {
      xp: p.xp,
      texts: boxes.map((b) => ({ text: b.text, box: b.box, alpha: b.alpha, missing: check(b.text) })),
      overlaps: overlaps(boxes),
      logoChars: logo.length,
      logoBounds: logo.length ? {
        x0: Math.min(...logo.map((t) => t.x)), x1: Math.max(...logo.map((t) => t.x + t.textWidth)),
        top: Math.min(...logo.map((t) => t.y)), bottom: Math.max(...logo.map((t) => t.y)),
      } : null,
    };
    await shot('w1-title-badge-default', { overlaps: report.overlaps.length });
    const out = { title: report };

    // The badge must also clear the animated logo and the menu panel, which the overlap pass excludes.
    const badgeObjs = ts.levelBadge || [];
    const badge = textBoxes({ list: badgeObjs, visible: true });
    const logoLeft = report.logoBounds ? report.logoBounds.x0 : 480;
    out.badgeBoxes = badge.map((b) => ({ text: b.text, ...b.box }));
    out.badgeTexts = badgeObjs.map((t) => t.main.text);
    out.clearOfLogo = badge.length > 0
      && badge.every((b) => b.box.x + b.box.w < logoLeft)
      && badge.every((b) => b.box.y + b.box.h < 92); // above the menu panel
    out.sanity = { badgeCount: badge.length, textCount: boxes.length, logoChars: logo.length };

    out.colourblind = await paletteSwap(game, e, collect);
    await shot('w1-title-badge-colorblind', {});
    return out;
  }

  async function runProfile(o) {
    const { game } = await bootTitle();
    const p = await seedProfile(game);
    const check = fontChars(game);
    const e = env(game);
    game.scene.start('TitleScene');
    step(e, 30);
    const ts = game.scene.getScene('TitleScene');
    const menu = ts.menu;

    // Drive the REAL menu: select the PROFILE row by label, then confirm.
    const out = { route: [], viaMenu: false };
    const selectProfile = () => {
      for (let i = 0; i < menu.items.length * 2; i++) {
        if (menu.items[menu.selected].label === 'PROFILE') return true;
        ts._onAction('down');
        step(e, 2);
        out.route.push(menu.items[menu.selected].label);
      }
      return false;
    };
    // A relative 'down' after a close lands on whatever row is selected next, so always target by label.
    out.reselects = selectProfile();
    ts._onAction('confirm');
    step(e, 12);
    out.viaMenu = out.reselects && Boolean(ts.view) && ts.view.constructor.name === 'ProfileView';
    out.openedBy = ts.view ? ts.view.constructor.name : null;

    const panel = ts.view.panel;
    const collect = () => textBoxes(panel);
    const boxes = collect();
    const panelBox = { x: panel.x, y: panel.y, w: ts.view.w, h: ts.view.h };
    const outside = (list) => list.filter((b) => b.box.x < panelBox.x + 1 || b.box.y < panelBox.y + 1
      || b.box.x + b.box.w > panelBox.x + panelBox.w - 1 || b.box.y + b.box.h > panelBox.y + panelBox.h - 1)
      .map((b) => b.text);
    const report = {
      panel: panelBox,
      texts: boxes.map((b) => ({ text: b.text, box: b.box, alpha: b.alpha, missing: check(b.text) })),
      overlaps: overlaps(boxes),
      clippedOutsidePanel: outside(boxes),
      missingGlyphs: [...new Set(boxes.flatMap((b) => check(b.text)))],
      hasBackButton: Boolean(ts.view.back),
      readOnly: !('save' in ts.view),
    };
    await shot('w1-profile-view-default', { overlaps: report.overlaps.length, clipped: report.clippedOutsidePanel.length });
    out.profile = report;

    out.colourblind = await paletteSwap(game, e, collect);
    await shot('w1-profile-view-colorblind', {});

    // Cancel and confirm both close, and closing must restore the title menu, not start a run.
    ts._onAction('cancel');
    step(e, 4);
    out.closesOnCancel = !ts.view;
    out.reselectsAgain = selectProfile();
    ts._onAction('confirm');
    step(e, 8);
    out.reopens = Boolean(ts.view) && ts.view.constructor.name === 'ProfileView';
    ts._onAction('confirm');
    step(e, 4);
    out.closesOnConfirm = !ts.view;
    out.stillOnTitle = game.scene.isActive('TitleScene') && !game.scene.isActive('RunScene');

    // A fresh profile must still render a complete, valid panel (no NaN, no blank view).
    const { defaultProfile } = await import('/src/systems/Progression.js');
    game.registry.set('profile', defaultProfile());
    selectProfile();
    ts._onAction('confirm');
    step(e, 8);
    out.freshOpenedProfile = Boolean(ts.view) && ts.view.constructor.name === 'ProfileView';
    const fresh = textBoxes(ts.view.panel);
    out.freshProfile = {
      texts: fresh.length,
      bad: fresh.filter((b) => /NaN|undefined|null/.test(b.text)).map((b) => b.text),
      overlaps: overlaps(fresh),
      clipped: outside(fresh),
    };
    await shot('w1-profile-view-fresh', { texts: fresh.length });
    return out;
  }

  async function run(o) {
    return { title: await runTitle(o), profile: await runProfile(o) };
  }
  window.__shotsProbe = { run, runTitle, runProfile };
})();
