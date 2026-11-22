// S1 regression: hostile values in every slot must give typed refusals, never a raw throw (fail-closed API contract).
import {
  validateManifest, validateEvidenceBundle, legacyManifestFromTape, resolveReplaySetup, evidenceBundle, ManifestError,
} from '../../src/systems/replay/manifest.js';
import { canonicalBytes, CJSONError } from '../../src/systems/replay/canonicalJson.js';
import { readJson, clone, legacyTape, ruleset, rulesetOf, liveTape, liveManifest } from './manifestFixtures.js';

const RS = ruleset();
const resolver = rulesetOf(RS);
const HOSTILE = [{}, [], null, { a: 1 }, [[]], [0], 'x', '', -1, 0, 1.5, 2 ** 40, true, false, 'f64:zz', { '__proto__x': 1 }];

/** Every path (arrays included) of a JSON value. */
function paths(v, prefix = []) {
  const out = [prefix];
  if (v && typeof v === 'object') for (const k of Object.keys(v)) out.push(...paths(v[k], [...prefix, k]));
  return out;
}
const setAt = (root, p, val) => { let o = root; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; };
const typed = (r) => r.ok === true || (r.ok === false && typeof r.code === 'string' && typeof r.pointer === 'string');

describe('hostile values never throw out of the validators', () => {
  test('S1 repro: an object in causal.input.protocol / protocolVersion is a typed refusal', () => {
    for (const slot of ['protocol', 'protocolVersion']) {
      for (const bad of [{}, [], null, { a: 1 }]) {
        const m = clone(readJson('manifest-v1.example.json'));
        m.causal.input[slot] = bad;
        const r = validateManifest(canonicalBytes(m), null);
        expect(r).toMatchObject({ ok: false, code: 'unsupported-input-protocol' });
      }
    }
  });

  test('every leaf and container of a manifest, mutated with every hostile value', () => {
    const base = readJson('manifest-v1.example.json');
    let n = 0;
    for (const p of paths(base).filter((x) => x.length)) {
      for (const h of HOSTILE) {
        const m = clone(base);
        setAt(m, p, h);
        let bytes;
        try { bytes = canonicalBytes(m); } catch (e) { expect(e).toBeInstanceOf(CJSONError); continue; }
        for (const rs of [null, resolver]) { const r = validateManifest(bytes, rs); expect(typed(r)).toBe(true); n++; }
      }
    }
    expect(n).toBeGreaterThan(1500);
  });

  test('every path of an evidence bundle (legacy and live), mutated with every hostile value', () => {
    const tape = liveTape();
    const bases = [evidenceBundle({ manifest: legacyManifestFromTape(legacyTape()), tape: legacyTape() }),
      evidenceBundle({ manifest: liveManifest({ tape }), tape, checkpoints: [[120, '0123456789abcdef']] })];
    let n = 0;
    for (const base of bases) {
      for (const p of paths(clone(base)).filter((x) => x.length && x[0] !== 'inputs')) {
        for (const h of HOSTILE) {
          const b = clone(base);
          setAt(b, p, h);
          let bytes;
          try { bytes = canonicalBytes(b); } catch (e) { expect(e).toBeInstanceOf(CJSONError); continue; }
          expect(typed(validateEvidenceBundle(bytes, null))).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  test('legacyManifestFromTape and resolveReplaySetup: hostile tapes give ManifestError or a result, never a raw throw', () => {
    const base = legacyTape();
    for (const p of paths(base).filter((x) => x.length && x[0] !== 'trace')) {
      for (const h of HOSTILE) {
        const t = clone(base);
        setAt(t, p, h);
        for (const f of [() => legacyManifestFromTape(t), () => resolveReplaySetup(t)]) {
          try { f(); } catch (e) { expect([ManifestError, CJSONError].some((C) => e instanceof C)).toBe(true); }
        }
      }
    }
  });
});
