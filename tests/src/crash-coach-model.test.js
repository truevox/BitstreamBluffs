import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const M = await import('../../src/ui/CrashCoachModel.js');
const { explainCrash } = await import('../../src/systems/coach/CrashCause.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { BANNED } = await import('./coachFixtures.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);
const scripted = (t) => H.livePad({ push: t < 400, variableHop: true, noAutoNudge: true, hop: t >= 300 && t <= 303, pressed: { hop: t === 300 } });
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1000 });
const TAPE = REC.tape;
const CRASH = REC.scene.registry.get(H.REG.LAST_CRASH);
const OK = { tape: TAPE, lastCrash: CRASH, runId: TAPE.runId, rulesetId: CURRENT_RULESET_ID };

describe('coachContext', () => {
  test('a real crashing run is eligible; the crash tick is endTick + 1 and the branch is 3 s earlier', () => {
    const c = M.coachContext(OK);
    expect(c).toMatchObject({ ok: true, crashTick: TAPE.endTick + 1, branchTick: TAPE.endTick + 1 - 360 });
  });
  test('NEGATIVE CONTROLS: another run, no crash, another build and a legacy tape are each refused with a reason', () => {
    expect(M.coachContext({ ...OK, runId: 'other' })).toMatchObject({ ok: false, reason: 'no-tape' });
    expect(M.coachContext({ ...OK, tape: null })).toMatchObject({ ok: false, reason: 'no-tape' });
    expect(M.coachContext({ ...OK, lastCrash: { ...CRASH, runId: 'other' } })).toMatchObject({ ok: false, reason: 'no-crash' });
    expect(M.coachContext({ ...OK, lastCrash: null })).toMatchObject({ ok: false, reason: 'no-crash' });
    expect(M.coachContext({ ...OK, rulesetId: 'sha256:other' })).toMatchObject({ ok: false, reason: 'ruleset-mismatch' });
    expect(M.coachContext({ ...OK, tape: { ...TAPE, edgeRows: undefined } })).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(M.coachContext({ ...OK, tape: { ...TAPE, mode: 'daily' } })).toMatchObject({ ok: false, reason: 'mode' });
  });
});

describe('practiceDescriptor', () => {
  test('is a takeover of the ORIGINAL tape at the branch tick, source "coach"', () => {
    const ctx = M.coachContext(OK);
    const r = M.practiceDescriptor(ctx, CURRENT_RULESET_ID);
    expect(r.ok).toBe(true);
    expect(r.descriptor).toMatchObject({ kind: 'bb-takeover', tick: ctx.branchTick, source: 'coach' });
    expect(r.descriptor.tape.inputs).toEqual(TAPE.inputs);
    expect(r.descriptor.tape.endTick).toBe(TAPE.endTick);
  });
  test('negative controls: a failed context or a changed build refuses', () => {
    expect(M.practiceDescriptor({ ok: false }, CURRENT_RULESET_ID).ok).toBe(false);
    expect(M.practiceDescriptor(M.coachContext(OK), 'sha256:other')).toMatchObject({ ok: false, reason: 'ruleset-mismatch' });
  });
});

describe('claimRows / wrapText / progressLine / buttons', () => {
  test('every claim row carries its evidence line', () => {
    const cause = explainCrash({ lastCrash: CRASH, crashTick: TAPE.endTick + 1, tape: TAPE });
    const rows = M.claimRows(cause);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) { expect(r.main).toBe(r.main.toUpperCase()); expect(r.sub).toMatch(/^EVIDENCE: (LASTCRASH|TAPE)\./); }
    expect(M.claimRows(cause, 2)).toHaveLength(2);
    expect(M.claimRows(null)).toEqual([]);
  });
  test('wrapText wraps by measured width and ellipsises past maxLines', () => {
    const m = (s) => s.length * 6;
    expect(M.wrapText('AAA BBB CCC DDD', 40, m)).toEqual(['AAA BBB', 'CCC DDD']);
    expect(M.wrapText('A B C D E F G H', 20, m, 2)).toEqual(['A B', 'C D...']);
    expect(M.wrapText('', 40, m)).toEqual([]);
  });
  test('progress line and button states', () => {
    expect(M.progressLine(null)).toMatch(/STARTING/);
    expect(M.progressLine({ searched: 3, planned: 64, survivors: 1, unstable: 2, elapsedMs: 8200 })).toBe('SEARCHED 3 OF 64   SURVIVED 1   UNSTABLE 2   8.2 S');
    const done = { survivors: [{}] };
    expect(M.buttonStates({ phase: 'done', result: done, canPractice: true })).toEqual({ alternative: true, practice: true });
    expect(M.buttonStates({ phase: 'running', result: null, canPractice: true })).toEqual({ alternative: false, practice: true });
    expect(M.buttonStates({ phase: 'done', result: { survivors: [] }, canPractice: false })).toEqual({ alternative: false, practice: false });
    expect(M.buttonStates({ phase: 'unavailable', result: null, canPractice: true }).practice).toBe(true);
  });
  test('static copy states the assumption, is unranked and never overclaims', () => {
    expect(M.COACH_ASSUMPTION).toMatch(/KEEP YOUR LAST INPUT/);
    expect(M.COACH_BANNER).toMatch(/UNRANKED/);
    expect(`${M.COACH_BANNER} ${M.COACH_ASSUMPTION} ${M.unavailableLine({ reason: 'x', message: 'bad tape' })}`).not.toMatch(BANNED);
  });
});
