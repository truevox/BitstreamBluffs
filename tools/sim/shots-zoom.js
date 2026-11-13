/*
 * Page-side zoom / look-ahead survey (window.__shotsZoom.run). Loaded after shots-page.js by tools/sim/shots.mjs.
 * Drives hop-policy runs with the HUD on; per frame measures how far ahead of the sled the screen shows (world px, m and
 * seconds at the current speed), per ground hazard how many seconds of travel were left when it entered the view, and
 * screenshots the first time each situation (speed band x grounded / air, hazard / launch-lip approach at speed) occurs.
 */
(() => {
  'use strict';
  const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const BINS = [[0, 450], [450, 650], [650, 850], [850, 1050], [1050, 1250], [1250, 9999]];
  const binOf = (v) => BINS.findIndex(([a, b]) => v >= a && v < b);

  async function run(o) {
    const S = window.__shots;
    const seeds = o.seeds || ['sim-01', 'sim-02', 'sim-03', 'sim-04', 'sim-05', 'sim-06'];
    const taken = new Set();
    const rows = BINS.map(() => ({ ground: [], air: [], zoom: [], sx: [] }));
    const hazRows = []; // {bin, speed, toReachS, zoom}
    const lipRows = [];
    const shots = []; let minTerrainMargin = 1e9; let maxSpeed = 0;
    for (const seed of seeds) {
      const env = await S.boot(seed);
      const M = env.M; const st = { lastHop: -1e9 };
      const seenHaz = new Set(); const seenLip = new Set();
      for (let f = 0; f < 60 * (o.maxSec || 200); f++) {
        S.hopPolicy(env, st);
        S.frame(env, false);
        const sc = env.scene; const s = sc.sled;
        if (sc.crashed || sc.pendingCrash) break;
        const v = sc._view; if (!v) continue;
        const speed = s.speed; maxSpeed = Math.max(maxSpeed, speed);
        const ahead = v.right - s.x; const warn = ahead / Math.max(speed, 1);
        const zoom = sc.cameras.main.zoom;
        const sxFrac = (s.x - v.left) / (v.right - v.left);
        const b = binOf(speed);
        if (b >= 0 && speed > 300) { rows[b][s.grounded ? 'ground' : 'air'].push(warn); rows[b].zoom.push(zoom); rows[b].sx.push(sxFrac); }
        const last = sc.terrain.activeList[sc.terrain.activeList.length - 1];
        if (last) minTerrainMargin = Math.min(minTerrainMargin, last.endX - v.right);
        // ground crash hazards entering the view, launch lips entering the view
        for (const list of sc.hazards.values()) {
          for (const h of list) {
            if (h.hit || h.def.placement === 'air' || (h.def.onHit && h.def.onHit.effect !== 'crash') || seenHaz.has(h)) continue;
            const dx = h.cx - s.x; if (dx <= 0) continue;
            if (h.cx - (h.w || 0) / 2 <= v.right) {
              seenHaz.add(h);
              hazRows.push({ seed, bin: b, speed: Math.round(speed), toReachS: r2(dx / Math.max(speed, 1)), dxPx: Math.round(dx), zoom, grounded: s.grounded });
              if (speed >= 800 && !taken.has('hazard-approach-' + (speed >= 1100 ? '1100' : '800'))) {
                const name = 'hazard-approach-' + (speed >= 1100 ? '1100' : '800');
                taken.add(name); S.frame(env, true);
                await window.__shot(name, { seed, speed: Math.round(speed), dxPx: Math.round(dx), toReachS: r2(dx / speed), zoom, sxFrac: r2(sxFrac), aheadPx: Math.round(ahead), grounded: s.grounded });
              }
            }
          }
        }
        for (const ch of sc.terrain.activeList) {
          for (const l of ch.launches || []) {
            if (l.x <= s.x || seenLip.has(l)) continue;
            if (l.x <= v.right) {
              seenLip.add(l);
              lipRows.push({ seed, bin: b, speed: Math.round(speed), toReachS: r2((l.x - s.x) / Math.max(speed, 1)), zoom });
              if (speed >= 800 && ch.defId === 'gen-jump' && !taken.has('lip-approach-' + (speed >= 1100 ? '1100' : '800'))) {
                const name = 'lip-approach-' + (speed >= 1100 ? '1100' : '800');
                taken.add(name); S.frame(env, true);
                await window.__shot(name, { seed, speed: Math.round(speed), toReachS: r2((l.x - s.x) / speed), zoom, sxFrac: r2(sxFrac), aheadPx: Math.round(ahead) });
              }
            }
          }
        }
        // situation shots: speed band x grounded / air
        for (const [target, lo, hi] of [[600, 560, 680], [900, 860, 960], [1200, 1150, 9999]]) {
          const name = `${s.grounded ? 'ground' : 'air'}-${target}`;
          if (speed >= lo && speed < hi && !taken.has(name) && f > 120) {
            taken.add(name); S.frame(env, true);
            await window.__shot(name, { seed, speed: Math.round(speed), zoom, sxFrac: r2(sxFrac), aheadPx: Math.round(ahead), aheadM: r2(ahead / M.PPM), warnS: r2(warn), grounded: s.grounded, hud: null });
          }
        }
      }
    }
    const table = BINS.map(([a, b], i) => ({
      band: `${a}-${b}`, groundFrames: rows[i].ground.length, airFrames: rows[i].air.length,
      groundWarnMedian: q(rows[i].ground, 0.5) == null ? null : r2(q(rows[i].ground, 0.5)), groundWarnMin: q(rows[i].ground, 0) == null ? null : r2(q(rows[i].ground, 0)),
      airWarnMedian: q(rows[i].air, 0.5) == null ? null : r2(q(rows[i].air, 0.5)), airWarnMin: q(rows[i].air, 0) == null ? null : r2(q(rows[i].air, 0)),
      zoomMedian: q(rows[i].zoom, 0.5), sledScreenXFracMedian: rows[i].sx.length ? r2(q(rows[i].sx, 0.5)) : null,
    }));
    const byBin = (arr) => BINS.map(([a, b], i) => { const t = arr.filter((r) => r.bin === i).map((r) => r.toReachS); return { band: `${a}-${b}`, n: t.length, min: t.length ? Math.min(...t) : null, median: q(t, 0.5) }; });
    return { table, hazardEntersView: byBin(hazRows), lipEntersView: byBin(lipRows), hazRows, lipRows, minTerrainMarginPx: Math.round(minTerrainMargin), maxSpeed: Math.round(maxSpeed) };
  }
  window.__shotsZoom = { run };
})();
