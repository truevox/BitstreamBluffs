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
import { parse } from '@babel/parser';

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
  // Original-stem notes, pressure ambience and event-gated cowbell are
  // ONLY Web Audio presentation. They never feed physics or recorded pads.
  'src/systems/music/CrystalChroma.js', 'src/systems/music/HydrostaticPressure.js', 'src/systems/music/ScrapCowbell.js',
  'src/ui/Backdrop.js', 'src/ui/LeaderboardTable.js', 'src/ui/MenuList.js', 'src/ui/MenuTerrain.js', 'src/ui/Motion.js', 'src/ui/Panel.js',
];
/** Files that must visibly use pmath (everything wired in #121). */
export const PMATH_USERS = [
  'src/entities/Sled.js', 'src/entities/Hazard.js', 'src/entities/TerrainMesh.js', 'src/scenes/RunScene.js', 'src/systems/PhysicsTuner.js',
  'src/systems/TerrainGenerator.js', 'src/systems/TerrainContact.js', 'src/systems/BsodAerodynamics.js', 'src/systems/BsodPursuit.js',
  'src/systems/ScoreManager.js', 'src/systems/ShardMagnet.js', 'src/systems/TrickTracker.js', 'src/systems/BiomeEffects.js', 'src/systems/MatterPortable.js',
];

// Reviewed, *exact* draw statements; moving native Math into a physics write cannot
// be excused by merely appending the string "pmath-exempt: draw-only". New graphics
// calls must be inspected and explicitly added here rather than silently accepted.
export const APPROVED_DRAW_ONLY_LINES = Object.freeze({
  "src/entities/PowerUp.js": [
    "const bob = Math.sin(t / 260 + this.spawn.x * 0.01) * 2.5;",
    "const pulse = 0.5 + 0.5 * Math.sin(t / 200);",
    "g.fillCircle(Math.cos(o) * 5.5, Math.sin(o) * 5.5, 1.3);",
    "g.lineBetween(0, 0, Math.sin(a) * r * 0.45, -Math.cos(a) * r * 0.45);",
    "const breathe = 1 + 0.12 * Math.sin(t / 250);",
    "const fl = 1 + 0.15 * Math.sin(t / 90);",
    "for (let k = 0; k < 6; k++) hx.push({ x: Math.cos((k * Math.PI) / 3) * 5.5, y: Math.sin((k * Math.PI) / 3) * 5.5 });",
    "g.fillCircle(0, 0.8 + Math.sin(t / 300) * 0.6, 2.6);",
    "const tilt = Math.sin(t / 260) * 0.5;",
    "g.strokeEllipse(0, 0, 12, 12 * (0.55 + 0.35 * Math.abs(Math.cos(tilt))));",
    "const sq = 1 + 0.4 * Math.abs(Math.sin(t / 220));"
  ],
  "src/entities/Shard.js": [
    "const pulse = 0.75 + 0.25 * Math.sin(timeMs / 140);",
    "const bob = s.pulled ? 0 : Math.sin(timeMs / 260 + s.x * 0.05) * 2;"
  ]
});

/**
 * @param {string} src file text
 * @param {{markersExempt?: boolean, approvedExemptions?:Set<string>}} [opt] reviewed draw-only statements
 * @returns {{line:number, why:string, text:string}[]} violations
 */
export function mathViolations(src, { markersExempt = false, approvedExemptions = new Set() } = {}) {
  // Parse JavaScript instead of regex-stripping comments: a string containing "/*" must
  // never hide a later Math.sin() from the simulation boundary check.
  const lines = src.split('\n');
  let ast;
  try {
    ast = parse(src, { sourceType: 'unambiguous', plugins: ['jsx', 'importAttributes'] });
  } catch (e) {
    return [{ line: e.loc?.line || 1, why: `cannot parse for native-Math boundary: ${e.message}`, text: lines[(e.loc?.line || 1) - 1] || '' }];
  }
  const permittedComments = new Set((ast.comments || [])
    .filter(c => c.type === 'CommentLine' && c.value.includes(EXEMPT_MARK))
    .map(c => c.loc.start.line));
  const out = [];
  const emit = (node, why) => {
    const line = node.loc?.start.line || 1;
    if (markersExempt && permittedComments.has(line) &&
        approvedExemptions.has((lines[line - 1] || '').split('// pmath-exempt: draw-only')[0].trim())) return;
    out.push({ line, why, text: (lines[line - 1] || '').trim() });
  };
  const staticString = n => {
    if (!n) return null;
    if (n.type === 'StringLiteral') return n.value;
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      const a = staticString(n.left), b = staticString(n.right);
      return a !== null && b !== null ? a + b : null;
    }
    return null;
  };
  const memberKey = node => {
    if (!node.computed) return node.property?.name || null;
    return staticString(node.property);
  };
  const member = n => n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression');
  const isGlobal = n => n && n.type === 'Identifier' && (n.name === 'globalThis' || n.name === 'window');
  const walk = (node, parent = null) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child, parent); return; }
    // Global-object aliases make the native Math property invisible to a naive
    // member-expression detector. Fail closed on introducing those aliases in
    // causal modules; existing code uses only direct known global properties.
    // Passing globalThis as a first-class argument can smuggle native Math to
    // an arbitrary callback. window is also used legitimately as an event target
    // (and as a local numerical variable); reject *inline* window callbacks,
    // not every occurrence of the identifier in application UI code.
    if (node.type === 'CallExpression' && node.arguments?.some(a => a?.type === 'Identifier' && a.name === 'globalThis')) {
      emit(node, 'globalThis passed as a first-class value');
    }
    if (node.type === 'CallExpression' &&
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.callee?.type) &&
        node.arguments?.some(a => a?.type === 'Identifier' && a.name === 'window')) {
      emit(node, 'window passed into an inline aliasing callback');
    }
    if (node.type === 'VariableDeclarator' && isGlobal(node.init)) emit(node, 'global-object alias may hide native Math');
    if (node.type === 'AssignmentExpression' && isGlobal(node.right)) emit(node, 'assignment aliases the global object');
    if (node.type === 'Identifier' && node.name === 'Math') {
      const direct = member(parent) && parent.object === node && !parent.computed && !parent.optional && ALLOWED_MATH.has(parent.property?.name);
      if (!direct) emit(node, 'Math used outside an allowed direct Math.<member>');
    }
    if (member(node) && isGlobal(node.object)) {
      const name = memberKey(node);
      if (name === 'Math' || (node.computed && name === null)) {
        emit(node, 'global computed/member access may reach native Math');
      }
    }
    if (node.type === 'BinaryExpression' && node.operator === '**') {
      const a = node.left, b = node.right;
      if (!(a.type === 'NumericLiteral' && b.type === 'NumericLiteral' && Number.isInteger(a.value) && Number.isInteger(b.value))) {
        emit(node, '** is only allowed between integer literals');
      }
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k === 'comments' || k === 'tokens' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      if (value && typeof value === 'object') walk(value, node);
    }
  };
  walk(ast.program);
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
    'string-delimited fake block comment': 'const a = "/*"; const y = Math.sin(x); const b = "*/";',
    'computed global Math': "const x = globalThis['Ma' + 'th'].sin(t);",
    'computed dynamic global': 'const x = globalThis[key](t);',
    'aliased global object': "const g = globalThis; const y = g['Math'].sin(t);",
    'aliased window': "let g; g = window; const y = g['Math'].sin(t);",
    'global passed to callback': "((g) => g['Math'].sin(t))(globalThis);",
    'globalThis passed to helper': 'const result = helper(globalThis);',
    'window passed to inline lambda': "((g) => g['Math'].sin(t))(window);",
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
    expect(mathViolations(src, { markersExempt: true, approvedExemptions: new Set(['const a = Math.sin(t);']) }).map((v) => v.line)).toEqual([2]);
  });
});

describe('every src file is on the allowlist, except explicit presentation files', () => {
  const scanned = allSrc.filter((f) => !PRESENTATION_FILES.includes(f) || tripwire.has(f));
  test('the scan covers src/ minus the presentation list (and the list has no stale entries)', () => {
    for (const f of PRESENTATION_FILES) expect(allSrc).toContain(f);
    expect(scanned.length).toBeGreaterThan(100);
  });
  test.each(scanned)('%s', (f) => { expect(mathViolations(read(f), { markersExempt: ['src/entities/PowerUp.js', 'src/entities/Shard.js'].includes(f), approvedExemptions: new Set(APPROVED_DRAW_ONLY_LINES[f] || []) })).toEqual([]); });
  test('draw-only marker cannot hide new causal writes even within a mixed-purpose entity', () => {
    const malicious = 'this.body.position.x = Math.sin(t); // pmath-exempt: draw-only';
    for (const f of Object.keys(APPROVED_DRAW_ONLY_LINES)) {
      expect(mathViolations(malicious, { markersExempt: true, approvedExemptions: new Set(APPROVED_DRAW_ONLY_LINES[f]) }).length).toBeGreaterThan(0);
    }
    for (const [f, lines] of Object.entries(APPROVED_DRAW_ONLY_LINES)) {
      const source = read(f);
      for (const line of lines) expect(source).toContain(line);
    }
  });
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
