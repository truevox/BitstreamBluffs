// Shared test helpers (not a test file). Reads content JSON with fs (no Vite import.meta.glob under Jest).
import fs from 'fs';
import path from 'path';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';

const dataDir = path.resolve('src/data');

export function readDir(sub) {
  const dir = path.join(dataDir, sub);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, d]));

export function loadContent() {
  return {
    chunks: readDir('chunks'),
    hazards: byId(readDir('hazards')),
    powerups: byId(readDir('powerups')),
    terrainMods: byId(readDir('terrainMods')),
    biomes: byId(readDir('biomes')),
  };
}

export function makeGen(seed = 'test-seed', overrides = {}) {
  const c = loadContent();
  return new TerrainGenerator({
    seed,
    chunkDefs: c.chunks,
    hazardDefs: c.hazards,
    powerupDefs: c.powerups,
    modDefs: c.terrainMods,
    biomeDefs: Object.values(c.biomes),
    ...overrides,
  });
}

export const segAngle = (p, i) => (Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x) * 180) / Math.PI;
export const inGap = (chunk, i) =>
  chunk.gaps.some((g) => chunk.points[i].x >= g.x0 && chunk.points[i + 1].x <= g.x1);

/** Points of chunks [0,n) as one polyline, bridge chunks excluded (their gap is a deliberate jump). */
export function solidPoints(gen, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = gen.getChunk(i);
    if (c.kind === 'bridge') continue;
    for (const p of c.points) if (!out.length || p.x > out[out.length - 1].x) out.push(p);
  }
  return out;
}

/**
 * 1-D rolling point mass along the polyline (65% of g*sin(slope), linear + quadratic drag, as seen in QA).
 * @returns {{stalledAtM:number|null, reachedM:number}} stall = < 10 px/s for more than 1 s.
 */
export function rollSim(gen, maxM, ppm = 20) {
  const nChunks = Math.ceil((maxM * ppm) / 1100) + 20;
  const pts = solidPoints(gen, nChunks);
  let v = 90;
  let i = 0;
  let pos = pts[0].x;
  let below = 0;
  for (let t = 0; i < pts.length - 2 && pos < maxM * ppm; t += 0.01) {
    const a = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    v = Math.max(0, v + (900 * Math.sin(a) * 0.65 - 0.2 * v - 0.0003 * v * v) * 0.01);
    pos += v * Math.cos(a) * 0.01;
    while (i < pts.length - 2 && pos >= pts[i + 1].x) i++;
    below = v < 10 ? below + 0.01 : 0;
    if (below > 1) return { stalledAtM: pos / ppm, reachedM: pos / ppm };
    if (t > 4000) break;
  }
  return { stalledAtM: null, reachedM: pos / ppm };
}

/**
 * Ballistic launch detector: from every ground point launch at speed v along the local tangent (g = 900),
 * measure flight time until the polyline is met again. A "launch" is a flight of >= minAirS seconds; flights do
 * not overlap. Returns [{x, y, airS, landX}] over chunks [0,n).
 */
export function findLaunches(gen, n, v = 450, minAirS = 0.6) {
  const chunks = [];
  for (let i = 0; i < n; i++) chunks.push(gen.getChunk(i));
  const pts = [];
  for (const c of chunks) for (const p of c.points) if (!pts.length || p.x > pts[pts.length - 1].x) pts.push({ x: p.x, y: p.y });
  const ground = (x, from) => {
    let k = from;
    while (k < pts.length - 2 && pts[k + 1].x < x) k++;
    const a = pts[k];
    const b = pts[k + 1];
    return [a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x), k];
  };
  const out = [];
  let skipTo = -1;
  for (let i = 1; i < pts.length - 2; i++) {
    if (pts[i].x <= skipTo) continue;
    const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const vx = v * Math.cos(a);
    const vy = v * Math.sin(a);
    let k = i;
    let landed = null;
    for (let t = 0.04; t < 3; t += 0.04) {
      const x = pts[i].x + vx * t;
      const y = pts[i].y + vy * t + 450 * t * t;
      if (x > pts[pts.length - 2].x) break;
      const [gy, kk] = ground(x, k);
      k = kk;
      if (y >= gy - 2 && t > 0.1) { landed = { t, x }; break; }
    }
    if (landed && landed.t >= minAirS) {
      out.push({ x: pts[i].x, y: pts[i].y, airS: landed.t, landX: landed.x });
      skipTo = landed.x;
    }
  }
  return out;
}
