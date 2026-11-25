/** #67 stage 2a: a REAL RunScene tape (headless harness) round-trips through the postcard codec; no mocks of the header. */
import { jest } from '@jest/globals';
import zlib from 'node:zlib';

const { installPhaserStub, createRun, stepRun } = await import('../replay/headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG } = await import('../../src/constants.js');
const { createPostcard, encodePostcard, decodePostcard, postcardCompatible, postcardToTakeoverInput, HEADER_FIELDS } = await import('../../src/systems/replay/Postcard.js');
const { SIM_REVISION } = await import('../../src/systems/replay/ruleset.js');

const codec = {
  async deflate(b) { return new Uint8Array(zlib.deflateRawSync(b, { level: 9 })); },
  async inflate(b, max) { return new Uint8Array(zlib.inflateRawSync(b, { maxOutputLength: max })); },
};
const RULESET = `sha256:${'a1'.repeat(32)}`; const BUILD = `sha256:${'b2'.repeat(32)}`;
const IDENTITY = { gameVersion: '2.22.7', simRevision: SIM_REVISION, rulesetId: RULESET, buildId: BUILD };

describe('a tape recorded by the real RunScene', () => {
  const scene = createRun(RunScene, REG, { seed: 'POSTCARD-REAL', level: 4 });
  const padAt = (t) => ({ tilt: t % 240 < 120 ? 1 : -1, push: t % 50 < 25, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false, tuck: false, brakeHeld: false,
    hop: false, reset: false, heli: 0, airBrake: false, parachute: false, pause: false, brake: false, lastSource: 'test',
    pressed: { hop: t % 97 === 0, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } });
  stepRun(scene, 600, padAt);
  const rec = scene.ghostRecorder;
  // main's header carries no rulesetId / buildId (the #72 stamp is not in this tree): stamp them header-only, as #72 does.
  const tape = rec ? { ...rec.finish({ runId: 'real-run-1', distanceM: 1, score: 1 }), rulesetId: RULESET, buildId: BUILD } : null;

  test('the harness really produced a tape with checkpoints and a combined fingerprint', () => {
    expect(rec).toBeTruthy();
    expect(tape.endTick).toBeGreaterThanOrEqual(600);
    expect(rec.fingerprints.length).toBeGreaterThan(0);
  });

  test('every causal field the real header carries is accepted, and only those cross', async () => {
    const at = 360;
    const fp = rec.fingerprints.find((f) => f.tick === at);
    expect(fp.combined).toMatch(/^xxh32x2:[0-9a-f]{16}$/);
    const r = createPostcard({ tape, startTick: at, windowSec: 5, fingerprintAtStart: fp.combined, identity: IDENTITY,
      challenge: { speedPxS: 300.5, angVel: 0.25, parachuteFuel: null, hazardPhase: null, bsodGapPx: 120 } });
    expect(r).toMatchObject({ ok: true });
    expect(Object.keys(r.postcard.header).sort()).toEqual([...HEADER_FIELDS].sort());
    const json = JSON.stringify(r.postcard);
    for (const n of ['startedAt', 'controlLayout', 'real-run-1', 'runId']) expect(json).not.toContain(n);
    const dec = await decodePostcard(await encodePostcard(r.postcard, { codec }), { codec });
    expect(dec.postcard).toEqual(r.postcard);
    expect(postcardCompatible(dec.postcard, IDENTITY)).toEqual({ ok: true });
    const input = postcardToTakeoverInput(dec.postcard);
    expect(input.tape.startPose).toEqual(tape.startPose);
    expect(input.tape.bsod).toEqual(tape.bsod);
    expect(input.tape.random).toEqual(tape.random);
    expect(input.tape.boosts).toEqual(tape.boosts);
    expect(input.tape.syncLevel).toBe(tape.syncLevel);
  });
});
