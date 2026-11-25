/** #72: new tape headers carry rulesetId + buildId, and the stamp is header-only (no ledger hash / checkpoint / fingerprint change). */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { takeoverEligible } = await import('../../src/systems/replay/Takeover.js');

const SEED = 'A'; // crashes at tick ~1394 under coastPad: a real record + ledgerHash

class Unstamped extends H.RunScene {
  _ghostHeader() { const h = super._ghostHeader(); delete h.rulesetId; delete h.buildId; return h; }
}

const FIXED_NOW = 1_767_000_000_000;
// describe() bodies run at collection time, before any beforeAll: the clock must be pinned at module level.
const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
afterAll(() => nowSpy.mockRestore());

describe('rulesetId / buildId header stamp', () => {
  const stamped = H.recordRun({ seed: SEED, padFor: H.coastPad });
  const bare = H.recordRun({ seed: SEED, padFor: H.coastPad, SceneClass: Unstamped });
  const again = H.recordRun({ seed: SEED, padFor: H.coastPad });

  test('the compile-time id equals the committed ruleset pointer', () => {
    expect(CURRENT_RULESET_ID).toBe(H.RULESET.rulesetId);
    expect(CURRENT_RULESET_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('a new tape is stamped with the exact current ruleset id and a build id', () => {
    expect(stamped.tape).toBeTruthy();
    expect(stamped.tape.rulesetId).toBe(CURRENT_RULESET_ID);
    expect(stamped.tape.buildId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stamped.tape.buildId).toBe(H.BUILD_ID);
  });

  test('negative control: the stamp is really absent on the control scene (so the equalities below are not vacuous)', () => {
    expect(bare.tape.rulesetId).toBeUndefined();
    expect(bare.tape.buildId).toBeUndefined();
  });

  test('before the async ruleset loader finishes: rulesetId is still stamped, buildId is null', () => {
    const early = H.recordRun({ seed: SEED, padFor: H.coastPad, maxTicks: 300, loadRuleset: false });
    const h = early.scene._ghostHeader();
    expect(h.rulesetId).toBe(CURRENT_RULESET_ID);
    expect(h.buildId).toBeNull();
  });

  test('a non-string build id on the registry is never stamped', () => {
    const early = H.recordRun({ seed: SEED, padFor: H.coastPad, maxTicks: 5 });
    early.scene.registry.set(H.BUILD_ID_KEY, { not: 'a string' });
    expect(early.scene._ghostHeader().buildId).toBeNull();
    early.scene.registry.set(H.BUILD_ID_KEY, H.BUILD_ID);
    expect(early.scene._ghostHeader().buildId).toBe(H.BUILD_ID);
  });

  test('control: two identical stamped runs have the same ledgerHash (the comparison basis is deterministic)', () => {
    expect(again.record.ledgerHash).toBe(stamped.record.ledgerHash);
  });

  test('the stamp does not change the record, its ledgerHash, any checkpoint, input row, trace or fingerprint', () => {
    expect(stamped.record).toBeTruthy();
    expect(stamped.record.ledgerHash).toMatch(/^[0-9a-f]+$/i);
    expect(stamped.record.ledgerHash).toBe(bare.record.ledgerHash);
    const strip = (r) => ({ ...r, id: undefined, startedAt: undefined, endedAt: undefined });
    expect(strip(stamped.record)).toEqual(strip(bare.record));
    expect(stamped.tape.checkpoints).toEqual(bare.tape.checkpoints);
    expect(stamped.tape.inputs).toEqual(bare.tape.inputs);
    expect(stamped.tape.trace).toBe(bare.tape.trace);
    expect(stamped.tape.endTick).toBe(bare.tape.endTick);
    expect([...stamped.fps]).toEqual([...bare.fps]);
    expect(stamped.fps.size).toBeGreaterThan(20);
  });

  test('a fresh stamped tape is takeover-eligible against the current id; the unstamped one is refused as older-build', () => {
    const n = Math.min(300, stamped.tape.endTick - 1);
    expect(takeoverEligible(stamped.tape, n, { rulesetId: CURRENT_RULESET_ID })).toEqual({ ok: true });
    expect(takeoverEligible(bare.tape, n, { rulesetId: CURRENT_RULESET_ID })).toMatchObject({ ok: false, reason: 'older-build' });
  });

  test('the replay-evidence path still validates a stamped tape (the extra header fields are inert there)', async () => {
    const { EVIDENCE_STATUS_KEY } = await import('../../src/systems/replay/evidenceCapture.js');
    let st;
    for (let i = 0; i < 400 && !st; i++) { st = stamped.scene.registry.get(EVIDENCE_STATUS_KEY); if (!st) await new Promise((r) => setTimeout(r, 5)); }
    expect(st).toMatchObject({ ok: true });
  });
});
