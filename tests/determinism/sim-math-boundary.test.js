// Issue #121: the simulation/presentation Math boundary. Authoritative simulation files must not call the native Math functions whose
// last bit differs between browser engines (they use src/systems/pmath.js instead), and must not use `**` (engines may approximate it).
// Every OTHER src file that still calls native transcendental Math must be listed as presentation below, so a new call site forces a decision.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANNED = 'sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|hypot|tanh|sinh|cosh|cbrt|sinh|cosh';
const CALL = new RegExp(`\\bMath\\s*\\.\\s*(${BANNED})\\b`, 'g'); // also catches `const f = Math.sin` aliasing, not only calls
const DESTRUCT = /=\s*Math\s*;|\{[^}]*\b(sin|cos|atan2|hypot|pow|exp)\b[^}]*\}\s*=\s*Math\b/;

/** Authoritative simulation: everything that runs inside RunScene.simTick, builds colliders/bodies or generates terrain. Mixed files (Sled, Hazard, RunScene) are entirely on pmath. */
export const SIM_FILES = [
  'src/entities/Sled.js', 'src/entities/Hazard.js', 'src/entities/TerrainMesh.js', 'src/scenes/RunScene.js',
  'src/systems/PhysicsTuner.js', 'src/systems/TerrainGenerator.js', 'src/systems/TerrainContact.js', 'src/systems/BsodAerodynamics.js',
  'src/systems/BsodPursuit.js', 'src/systems/ScoreManager.js', 'src/systems/ShardMagnet.js', 'src/systems/TrickTracker.js',
  'src/systems/BiomeEffects.js', 'src/systems/MatterPortable.js',
];
/** Presentation only (drawing, audio, UI, particles, menus): never read back into simulation state; native Math is fine. */
export const PRESENTATION_FILES = [
  'src/entities/AirTelegraph.js', 'src/entities/Background.js', 'src/entities/BestMarker.js', 'src/entities/Fx.js', 'src/entities/GhostRider.js',
  'src/entities/GroundTelegraph.js', 'src/entities/KodiakRider.js', 'src/entities/LastDeathMarker.js', 'src/entities/PowerUp.js', 'src/entities/Shard.js',
  'src/entities/SongBillboard.js', 'src/scenes/GameOverScene.js', 'src/scenes/TitleScene.js', 'src/scenes/UIScene.js', 'src/shaders/GlitchPipeline.js',
  'src/systems/AudioSynth.js', 'src/systems/MicroBees.js', 'src/systems/WorldDance.js', 'src/systems/music/AdaptiveBiomeRouter.js',
  'src/systems/music/BsodThreatProcessor.js', 'src/systems/music/ImpulseBank.js', 'src/systems/music/MusicFXGraph.js', 'src/ui/Backdrop.js',
  'src/ui/LeaderboardTable.js', 'src/ui/MenuList.js', 'src/ui/MenuTerrain.js', 'src/ui/Motion.js', 'src/ui/Panel.js',
];

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const read = (f) => strip(fs.readFileSync(path.join(root, f), 'utf8'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

describe('simulation files use pmath, not native transcendental Math', () => {
  test.each(SIM_FILES)('%s has no native transcendental Math and no ** operator', (f) => {
    const src = read(f);
    expect(src.match(CALL) || []).toEqual([]);
    expect(DESTRUCT.test(src)).toBe(false);
    expect((src.match(/[^*/]\*\*(?!\/)/g) || []).length).toBe(0);
  });
  test.each(SIM_FILES.filter((f) => f !== 'src/systems/MatterPortable.js'))('%s imports pmath', (f) => {
    expect(read(f)).toMatch(/import pmath from '[./]+(?:systems\/)?(?:\.\/)?pmath\.js'|from '[./]*pmath\.js'/);
  });
  test('pmath.js and MatterPortable.js are pure (no Phaser, no clock, no random)', () => {
    for (const f of ['src/systems/pmath.js', 'src/systems/MatterPortable.js']) expect(read(f)).not.toMatch(/from 'phaser'|Date\.now|performance\.now|Math\.random/);
  });
});

describe('every other native-Math call site is classified as presentation', () => {
  test('no unclassified src file calls native transcendental Math', () => {
    const known = new Set([...SIM_FILES, ...PRESENTATION_FILES, 'src/systems/pmath.js']);
    const offenders = walk(path.join(root, 'src')).map((p) => path.relative(root, p).replace(/\\/g, '/')).filter((f) => !known.has(f) && CALL.test(read(f)) && (CALL.lastIndex = 0, true));
    expect(offenders).toEqual([]);
  });
  test('the presentation list has no stale entries (each still calls native Math) and none is a sim file', () => {
    for (const f of PRESENTATION_FILES) { CALL.lastIndex = 0; expect(CALL.test(read(f))).toBe(true); expect(SIM_FILES).not.toContain(f); }
  });
  test('the sim files named here exist and src/systems/replay (verification code) is free of native transcendental Math', () => {
    for (const f of SIM_FILES) expect(fs.existsSync(path.join(root, f))).toBe(true);
    for (const p of walk(path.join(root, 'src', 'systems', 'replay'))) { CALL.lastIndex = 0; expect(CALL.test(strip(fs.readFileSync(p, 'utf8')))).toBe(false); }
  });
});
