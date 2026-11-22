// Issue #121: the simulation/presentation Math boundary, as an ALLOWLIST (not a list of banned names).
//
// Rule: in every scanned file, each use of the `Math` object must be `Math.<member>` for one of ALLOWED_MATH (members whose results ECMAScript
// specifies exactly, so every engine returns the same bits), and `**` may only combine two integer literals (a compile-time constant such as
// `2 ** 40`). Everything else fails, whatever the syntax: `Math.sin(x)`, `const { sin } = Math`, `const M = Math; M.tan(x)`, `Math['exp'](x)`,
// `Math?.pow(x, 2)`, `globalThis.Math.cos(x)`, `Phaser.Math.Between(...)`, `x ** 0.5`, `x ** 2`. Transcendental functions come from
// src/systems/pmath.js instead (a facade over the pinned @stdlib packages).
//
// Scanned: ALL of src/ except PRESENTATION_FILES (drawing, audio, UI, menus, particles). A presentation file that is ALSO a causal
// tripwire file (tools/ruleset/lib.mjs TRIPWIRE_FILES, e.g. PowerUp.js, Shard.js) is not exempt as a whole: each native call must sit on a line
// that carries a `pmath-exempt: draw-only` comment, so a later edit that feeds native math into a body or collection position is caught.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TRIPWIRE_FILES } from '../../tools/ruleset/lib.mjs';
import { makeGen } from '../src/_helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Exactly specified by ECMAScript (+, -, *, /, sqrt, rounding and bit operations are IEEE/integer exact); no transcendental, no random. */
export const ALLOWED_MATH = new Set(['abs', 'floor', 'ceil', 'round', 'trunc', 'sign', 'min', 'max', 'sqrt', 'imul', 'fround', 'clz32', 'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2']);
export const EXEMPT_MARK = 'pmath-exempt: draw-only';

/** Presentation only (drawing, audio, UI, menus, particles): never read back into simulation state; native Math (and Phaser.Math) is fine. */
export const PRESENTATION_FILES = [
  'src/entities/AirTelegraph.js', 'src/entities/Background.js', 'src/entities/BestMarker.js', 'src/entities/Fx.js', 'src/entities/GhostRider.js',
  'src/entities/GroundTelegraph.js', 'src/entities/KodiakRider.js', 'src/entities/LastDeathMarker.js', 'src/entities/PowerUp.js', 'src/entities/Shard.js',
  'src/entities/SongBillboard.js', 'src/scenes/GameOverScene.js', 'src/scenes/PauseScene.js', 'src/scenes/TitleScene.js', 'src/scenes/UIScene.js',
  'src/shaders/GlitchPipeline.js', 'src/systems/AudioSynth.js', 'src/systems/MicroBees.js', 'src/systems/WorldDance.js',
  'src/systems/music/AdaptiveBiomeRouter.js', 'src/systems/music/BsodThreatProcessor.js', 'src/systems/music/ImpulseBank.js', 'src/systems/music/MusicFXGraph.js',
  'src/ui/Backdrop.js', 'src/ui/LeaderboardTable.js', 'src/ui/MenuList.js', 'src/ui/MenuTerrain.js', 'src/ui/Motion.js', 'src/ui/Panel.js',
];
/** Files that must visibly use pmath (everything wired in #121). */
export const PMATH_USERS = [
  'src/entities/Sled.js', 'src/entities/Hazard.js', 'src/entities/TerrainMesh.js', 'src/scenes/RunScene.js', 'src/systems/PhysicsTuner.js',
  'src/systems/TerrainGenerator.js', 'src/systems/TerrainContact.js', 'src/systems/BsodAerodynamics.js', 'src/systems/BsodPursuit.js',
  'src/systems/ScoreManager.js', 'src/systems/ShardMagnet.js', 'src/systems/TrickTracker.js', 'src/systems/BiomeEffects.js', 'src/systems/MatterPortable.js',
];

/**
 * @param {string} src file text
 * @param {{markersExempt?: boolean}} [opt] honour `pmath-exempt: draw-only` line markers
 * @returns {{line:number, why:string, text:string}[]} violations
 */
export function mathViolations(src, { markersExempt = false } = {}) {
  const out = [];
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  noBlock.split('\n').forEach((raw, i) => {
    if (markersExempt && raw.includes(EXEMPT_MARK)) return;
    const code = raw.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
    for (const m of code.matchAll(/\bMath\b/g)) {
      const before = code.slice(0, m.index), after = code.slice(m.index + 4);
      if (/\.\s*$/.test(before) || /\?\.\s*$/.test(before)) { out.push({ line: i + 1, why: 'Math reached through another object', text: code.trim() }); continue; }
      const member = /^\s*\.\s*([A-Za-z0-9_$]+)/.exec(after);
      if (!member) out.push({ line: i + 1, why: 'Math used other than as Math.<member> (alias, destructuring, bracket or optional access)', text: code.trim() });
      else if (!ALLOWED_MATH.has(member[1])) out.push({ line: i + 1, why: `Math.${member[1]} is not on the allowlist`, text: code.trim() });
    }
    for (const m of code.matchAll(/\*\*/g)) {
      const before = code.slice(0, m.index), after = code.slice(m.index + 2);
      if (!(/\b\d+\s*$/.test(before) && /^\s*\d+\b(?![.\d])/.test(after))) out.push({ line: i + 1, why: '** is only allowed between two integer literals', text: code.trim() });
    }
  });
  return out;
}

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const allSrc = walk(path.join(root, 'src')).map((p) => path.relative(root, p).replace(/\\/g, '/')).sort();
const tripwire = new Set(TRIPWIRE_FILES);

describe('the scanner itself: every bypass is caught, legitimate code passes', () => {
  const bad = {
    'direct call': 'const y = Math.sin(x);',
    'destructuring with semicolon': 'const { sin, cos } = Math;',
    'destructuring without semicolon': 'const { tanh, acos } = Math\nconst z = 1',
    'alias': 'const M = Math\nM.tan(x)',
    'bracket access': "const y = Math['exp'](x);",
    'bracket access, double quotes': 'const y = Math["cos"](x);',
    'optional chaining': 'const y = Math?.atan2(x, 1);',
    'optional chaining on a member': 'const y = Math?.pow(x, 2);',
    'through globalThis': 'const y = globalThis.Math.cos(x);',
    'through window': 'const y = window.Math.sin(x);',
    'through Phaser': 'const y = Phaser.Math.Between(1, 2);',
    'passed as a value': 'doIt(Math);',
    'Math.random': 'const r = Math.random();',
    'Math.hypot': 'const h = Math.hypot(a, b);',
    'Math.cbrt': 'const h = Math.cbrt(a);',
    'non-integer exponent': 'const y = x ** 0.5;',
    'integer exponent on a variable': 'const y = x ** 2;',
    'exponent after a call': 'const y = f(x) ** 3;',
    'multi-line destructuring': 'const {\n  sin,\n} = Math;',
  };
  for (const [name, src] of Object.entries(bad)) test(`catches: ${name}`, () => { expect(mathViolations(src).length).toBeGreaterThan(0); });
  const good = {
    'exact members': 'const a = Math.abs(x) + Math.floor(y) + Math.ceil(z) + Math.round(w) + Math.trunc(v) + Math.sign(u) + Math.min(a, b) + Math.max(a, b) + Math.sqrt(c);',
    'constants and bit ops': 'const t = Math.PI * 2 + Math.E + Math.imul(a, b) + Math.fround(c) + Math.clz32(d);',
    'literal ** literal': 'const big = 2 ** 40;',
    'comment mentioning Math.sin': '// Math.sin(x) is replaced by pmath.sin(x)\nconst a = 1;',
    'block comment mentioning Math.sin': '/* Math.sin(x) and Math["cos"] */ const a = 1;',
    'pmath call': 'const y = pmath.sin(x) + pmath.hypot(a, b);',
    'identifier merely containing Math': 'const MathUtils = 1; const myMath = 2;',
  };
  for (const [name, src] of Object.entries(good)) test(`allows: ${name}`, () => { expect(mathViolations(src)).toEqual([]); });
  test('a draw-only marker exempts one line only when markers are honoured', () => {
    const src = `const a = Math.sin(t); // ${EXEMPT_MARK}\nconst b = Math.cos(t);`;
    expect(mathViolations(src).length).toBe(2);
    expect(mathViolations(src, { markersExempt: true }).map((v) => v.line)).toEqual([2]);
  });
});

describe('every src file is on the allowlist, except explicit presentation files', () => {
  const scanned = allSrc.filter((f) => !PRESENTATION_FILES.includes(f) || tripwire.has(f));
  test('the scan covers src/ minus the presentation list (and the list has no stale entries)', () => {
    for (const f of PRESENTATION_FILES) expect(allSrc).toContain(f);
    expect(scanned.length).toBeGreaterThan(100);
  });
  test.each(scanned)('%s', (f) => { expect(mathViolations(read(f), { markersExempt: tripwire.has(f) })).toEqual([]); });
  test('a presentation file is not exempt as a whole when it is a causal tripwire file', () => {
    const both = PRESENTATION_FILES.filter((f) => tripwire.has(f));
    expect(both.sort()).toEqual(['src/entities/PowerUp.js', 'src/entities/Shard.js']); // changing this list means re-reading why they are causal
    for (const f of both) expect(read(f)).toContain(EXEMPT_MARK);
  });
  test('presentation files really still use native Math (no stale exemptions)', () => {
    for (const f of PRESENTATION_FILES) expect(mathViolations(read(f)).length).toBeGreaterThan(0);
  });
});

describe('pmath wiring', () => {
  test.each(PMATH_USERS.filter((f) => f !== 'src/systems/MatterPortable.js'))('%s imports pmath', (f) => {
    expect(read(f)).toMatch(/import pmath from '[./]+(?:systems\/)?(?:\.\/)?pmath\.js'/);
  });
  test('pmath.js and MatterPortable.js are pure (no Phaser, no clock, no random)', () => {
    for (const f of ['src/systems/pmath.js', 'src/systems/MatterPortable.js']) expect(read(f).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/from 'phaser'|Date\.now|performance\.now|Math\.random/);
  });
  test('only TerrainMesh calls Bodies.fromVertices, with 4-vertex trapezoids (always convex), so poly-decomp is never used on the sim path', () => {
    const users = allSrc.filter((f) => /\bfromVertices\b/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    expect(users).toEqual(['src/entities/TerrainMesh.js']);
    expect(read('src/entities/TerrainMesh.js')).toMatch(/\{ x: a\.x, y: a\.y \},\s*\{ x: b\.x, y: b\.y \},\s*\{ x: b\.x, y: b\.y \+ COLLIDER_DEPTH \},\s*\{ x: a\.x, y: a\.y \+ COLLIDER_DEPTH \}/);
  });
  test('generated terrain has strictly increasing x everywhere, so every collider quad is a convex trapezoid', () => {
    for (const mask of [0, 1, 4, 64, 2047]) for (const seed of ['alpha', 'gamma7', 'daily-2026-11-12']) {
      const g = makeGen(seed, { biomeMask: mask });
      for (let i = 0; i < 120; i++) { const pts = g.getChunk(i).points; for (let k = 1; k < pts.length; k++) expect(pts[k].x).toBeGreaterThan(pts[k - 1].x); }
    }
  });
  test('Phaser force/thrust helpers (native trig in Phaser\'s Matter wrapper) are never used', () => {
    for (const f of allSrc) expect(read(f).replace(/\/\/.*$/gm, '')).not.toMatch(/applyForceFromAngle|\.thrust(?:Left|Right|Back)?\(|\.thrustBack\(/);
  });
});
