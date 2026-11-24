/**
 * Micro Mountain glow-up: HUGE bees in the backdrop (cosmetic only).
 *
 * SledHEAD canon: Micro Mountain is Pete's bee meadow, ridden as an RC micro sled drone, so ordinary bees are
 * HUGE next to the rider. These pin the pure placement/motion (src/systems/MicroBees.js) and how the
 * dew-drops backdrop draws it: few, big, slow, seeded, low-alpha, palette keys only, behind the terrain.
 */
import fs from 'fs';
import { GAME_WIDTH, GAME_HEIGHT } from '../../src/constants.js';
import { beesAt, beePrimitives, beeLayout, BEE_MAX_FILL_ALPHA, BEE_MAX_LINE_ALPHA } from '../../src/systems/MicroBees.js';
import { Background, motifDecor, motifGeometry, MOTIFS } from '../../src/entities/Background.js';

const SCROLLS = [];
for (let x = 0; x < 80_000; x += 613) SCROLLS.push(x);
const TIMES = [0, 900, 5_000, 31_000, 120_000];
const XM = 96; // the W6 decor overhang rule (biome-backdrops-w6.test.js)
const PALETTE_KEYS = ['bg', 'bgAlt', 'cyan', 'magenta', 'lime', 'amber', 'text'];
const pointsOf = (d) => (d.kind === 'circle' ? [{ x: d.x - d.r, y: d.y - d.r }, { x: d.x + d.r, y: d.y + d.r }] : d.pts);

describe('MicroBees: placement and motion (pure)', () => {
  test('deterministic: same scroll, time and seed give the same bees', () => {
    for (const x of [0, 4321, 77_777]) expect(beesAt(x, 1234, 0)).toEqual(beesAt(x, 1234, 0));
  });

  test('seeded: another seed lays the bees out differently', () => {
    expect(beeLayout(0)).not.toEqual(beeLayout(7));
    expect(beeLayout(3)).toEqual(beeLayout(3));
  });

  test('few: never more than two bees on screen, and some screens have one', () => {
    let most = 0;
    let withBee = 0;
    let n = 0;
    for (const x of SCROLLS) {
      for (const t of TIMES) {
        const b = beesAt(x, t, 0);
        most = Math.max(most, b.length);
        if (b.length) withBee += 1;
        n += 1;
      }
    }
    expect(most).toBeLessThanOrEqual(2);
    expect(withBee / n).toBeGreaterThan(0.25);
    expect(withBee / n).toBeLessThan(0.9);
  });

  test('HUGE: each bee stands a quarter to a half of the screen height', () => {
    let seen = 0;
    for (const x of SCROLLS) {
      for (const bee of beesAt(x, 2000, 0)) {
        const pts = beePrimitives([bee], 1).flatMap(pointsOf);
        const ys = pts.map((p) => p.y);
        const h = Math.max(...ys) - Math.min(...ys);
        expect(h).toBeGreaterThanOrEqual(0.25 * GAME_HEIGHT);
        expect(h).toBeLessThanOrEqual(0.5 * GAME_HEIGHT);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  test('slow: with the camera still, a bee drifts under 20 px a second', () => {
    for (const x of [500, 9000, 40_000]) {
      const a = beesAt(x, 10_000, 0);
      const b = beesAt(x, 11_000, 0);
      for (const bee of a) {
        const same = b.find((o) => o.id === bee.id);
        if (same) expect(Math.abs(same.x - bee.x)).toBeLessThan(20);
      }
    }
  });

  test('wings a blur: the flap changes from frame to frame (scene time only)', () => {
    let changed = false;
    for (const x of SCROLLS) {
      const a = beesAt(x, 1000, 0);
      const b = beesAt(x, 1016, 0);
      if (a.length && b.length && a[0].flap !== b[0].flap) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  test('no Math.random or Date.now anywhere in the module', () => {
    const src = fs.readFileSync('src/systems/MicroBees.js', 'utf8');
    expect(src).not.toMatch(/Math\.random\(|Date\.now\(|performance\.now\(|from 'phaser'/);
  });
});

describe('MicroBees: what is drawn', () => {
  const all = [];
  for (const x of SCROLLS) for (const t of TIMES) all.push(...beePrimitives(beesAt(x, t, 0), 1));

  test('there is something to check', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  test('palette keys only, never danger', () => {
    for (const d of all) expect(PALETTE_KEYS).toContain(d.color);
  });

  test('low alpha everywhere, so hazards and pickups keep their contrast', () => {
    for (const d of all) {
      if (d.kind === 'line') expect(d.alpha).toBeLessThanOrEqual(BEE_MAX_LINE_ALPHA);
      else {
        if (d.color !== 'bg') expect(d.fillAlpha).toBeLessThanOrEqual(BEE_MAX_FILL_ALPHA);
        expect(d.lineAlpha).toBeLessThanOrEqual(BEE_MAX_LINE_ALPHA);
      }
    }
    expect(BEE_MAX_FILL_ALPHA).toBeLessThanOrEqual(0.12);
    expect(BEE_MAX_LINE_ALPHA).toBeLessThanOrEqual(0.35);
  });

  test('inside the W6 decor bounds (0..270 high, 96 px overhang left and right), circles under r 40', () => {
    for (const d of all) {
      for (const p of pointsOf(d)) {
        const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -XM && p.x <= GAME_WIDTH + XM && p.y >= 0 && p.y <= GAME_HEIGHT;
        if (!ok) throw new Error(`${d.kind} point (${p.x}, ${p.y}) off screen`);
      }
      if (d.kind === 'circle') expect(d.r > 0 && d.r < 40).toBe(true);
    }
  });

  test('every primitive carries the depth it was asked for and its bee tag', () => {
    const b = beesAt(SCROLLS.find((x) => beesAt(x, 0, 0).length), 0, 0);
    for (const d of beePrimitives(b, 3)) {
      expect(d.depth).toBe(3);
      expect(Number.isInteger(d.bee)).toBe(true);
    }
  });
});

describe('MicroBees in the dew-drops backdrop', () => {
  const beeX = SCROLLS.find((x) => beesAt(x, 0, 0).length > 0);
  const last = motifGeometry('dew-drops', 0).layers.length - 1;

  test('Micro Mountain\'s dew-drops decor includes the bees, after the near silhouette layer', () => {
    const decor = motifDecor('dew-drops', beeX, 0, 0);
    const bees = decor.filter((d) => d.bee !== undefined);
    expect(bees.length).toBeGreaterThan(0);
    for (const d of bees) expect(d.depth).toBe(last);
    // drawn after the near layer's own decor, so a bee is over the moss and blades, under the terrain
    expect(decor.findIndex((d) => d.bee !== undefined)).toBeGreaterThan(decor.findIndex((d) => d.depth === last));
  });

  test('{bees:false} draws the same backdrop without them', () => {
    const on = motifDecor('dew-drops', beeX, 0, 0);
    const off = motifDecor('dew-drops', beeX, 0, 0, { bees: false });
    expect(off).toEqual(on.filter((d) => d.bee === undefined));
  });

  test('no other motif has bees', () => {
    for (const m of MOTIFS.filter((id) => id !== 'dew-drops')) {
      for (const x of SCROLLS.slice(0, 40)) expect(motifDecor(m, x, 0, 0).some((d) => d.bee !== undefined)).toBe(false);
    }
  });

  const recordingScene = () => {
    const gfx = new Proxy({}, { get: (_, k) => (k === 'setScrollFactor' || k === 'setDepth' ? () => gfx : () => gfx) });
    return { add: { graphics: () => gfx } };
  };
  const PAL = { bg: 1, bgAlt: 2, cyan: 3, magenta: 4, lime: 5, amber: 6, text: 7, danger: 8 };

  test('Background counts the bees it drew: some on Micro, none elsewhere', () => {
    const bg = new Background(recordingScene(), PAL);
    bg.setMotif('dew-drops');
    bg.update(beeX, 0, 0);
    expect(bg.beeCount).toBeGreaterThan(0);
    bg.setMotif(null);
    bg.update(beeX, 0, 0);
    expect(bg.beeCount).toBe(0);
    bg.setMotif('vents');
    bg.update(beeX, 0, 0);
    expect(bg.beeCount).toBe(0);
  });

  test('Background.bees = false (the perf comparison switch) draws none', () => {
    const bg = new Background(recordingScene(), PAL);
    bg.setMotif('dew-drops');
    bg.bees = false;
    bg.update(beeX, 0, 0);
    expect(bg.beeCount).toBe(0);
  });
});

/** WCAG relative luminance and contrast, for the hazard-contrast bound below. */
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (base, top, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * (1 - a) + parseInt(top.slice(i, i + 2), 16) * a).toString(16).padStart(2, '0')).join('')}`;

const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]; const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

describe('MicroBees: hazard and pickup contrast (worst case)', () => {
  const PALETTES = JSON.parse(fs.readFileSync('src/data/palettes.json', 'utf8'));
  const MICRO = JSON.parse(fs.readFileSync('src/data/biomes/micro-mountain.json', 'utf8'));
  // Rasterise real bees on a 2 px grid over plain sky (fills composited in draw order) and keep the brightest
  // pixel a bee can put behind a hazard. "As readable as now" = no worse than the brightest thing the Micro
  // backdrop ALREADY puts behind a hazard: the near moss layer (cyan 0.08) under a grass blade (lime 0.18).
  test.each(['default', 'colorblind'])('%s palette: a Dew Drop (danger) or Royal Jelly (amber) in front of a bee keeps at least the contrast it has against the existing Micro backdrop', (name) => {
    const pal = { ...PALETTES[name], ...MICRO.palettes[name] };
    const existing = blend(blend(pal.bg, pal.cyan, 0.08), pal.lime, 0.18);
    let worst = pal.bg;
    let samples = 0;
    for (let x = 0; x < 40_000; x += 997) {
      for (const bee of beesAt(x, 3000, 0)) {
        const prims = beePrimitives([bee], 1).filter((d) => d.kind !== 'line' && d.fillAlpha > 0);
        for (let gx = bee.x - 80; gx < bee.x + 80; gx += 2) {
          for (let gy = bee.y - 70; gy < bee.y + 50; gy += 2) {
            let c = pal.bg;
            for (const d of prims) {
              const inside = d.kind === 'circle' ? (gx - d.x) ** 2 + (gy - d.y) ** 2 <= d.r * d.r : inPoly(gx, gy, d.pts);
              if (inside) c = blend(c, pal[d.color], d.fillAlpha);
            }
            if (lum(c) > lum(worst)) worst = c;
            samples += 1;
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(10_000);
    expect(worst).not.toBe(pal.bg); // the bees are actually there
    for (const target of ['danger', 'amber']) {
      expect({ name, target, ok: contrast(pal[target], worst) >= contrast(pal[target], existing) })
        .toEqual({ name, target, ok: true });
    }
  });
});
