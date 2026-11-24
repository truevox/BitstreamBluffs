import { HintScheduler, HINT_DEFS } from '../../src/systems/HintScheduler.js';

/** Drive the scheduler at 60 Hz with a wants(t) function; returns the event log [{t,id,show}]. */
function run(sch, fromMs, toMs, wantsAt, dangerAt = () => false) {
  const log = [];
  for (let t = fromMs; t <= toMs; t += 16) {
    for (const e of sch.update(t, wantsAt(t), dangerAt(t))) log.push({ t, ...e });
  }
  return log;
}
const shownSpans = (log) => {
  const up = {}; const spans = [];
  for (const e of log) { if (e.show) up[e.id] = e.t; else spans.push({ id: e.id, from: up[e.id], to: e.t }); }
  return spans;
};

describe('HintScheduler', () => {
  test('nothing shows before startMs except early hints', () => {
    const s = new HintScheduler();
    const log = run(s, 0, 2000, () => ({ hop: true, tuck: true, push: false }));
    expect(log).toEqual([]);
    const s2 = new HintScheduler();
    expect(run(s2, 0, 100, () => ({ push: true, hop: true }))[0]).toMatchObject({ id: 'push', show: true });
  });

  test('a hint stays at least minMs even when its trigger vanishes at once', () => {
    const s = new HintScheduler();
    const log = run(s, 3000, 9000, (t) => ({ flip: t < 3200 }));
    const [sp] = shownSpans(log);
    expect(sp.id).toBe('flip');
    expect(sp.to - sp.from).toBeGreaterThanOrEqual(HINT_DEFS.flip.minMs);
    expect(sp.to - sp.from).toBeLessThan(HINT_DEFS.flip.minMs + 40);
  });

  test('never two at once, gap after hide, priority order, hide after maxMs even if trigger stays', () => {
    const s = new HintScheduler();
    const log = run(s, 3000, 30000, () => ({ tuck: true, flip: true, hop: true }));
    let up = 0;
    for (const e of log) { up += e.show ? 1 : -1; expect(up).toBeLessThanOrEqual(1); }
    expect(log[0]).toMatchObject({ id: 'hop', show: true });
    const spans = shownSpans(log);
    for (let i = 1; i < spans.length; i++) expect(spans[i].from - spans[i - 1].to).toBeGreaterThanOrEqual(s.gapMs);
    for (const sp of spans) expect(sp.to - sp.from).toBeLessThanOrEqual(HINT_DEFS[sp.id].maxMs + 40);
    // a timed-out hint with a permanently-true trigger does not come back
    expect(log.filter((e) => e.show && e.id === 'hop').length).toBe(1);
  });

  test('a higher-priority want replaces the current hint only after its minimum', () => {
    const s = new HintScheduler();
    const log = run(s, 3000, 8000, (t) => ({ tuck: true, hop: t >= 3500 }));
    const hop = log.find((e) => e.id === 'hop' && e.show);
    const tuckUp = log.find((e) => e.id === 'tuck' && e.show).t;
    expect(hop.t - tuckUp).toBeGreaterThanOrEqual(HINT_DEFS.tuck.minMs);
  });

  test('danger holds back non-danger hints; danger hints still show', () => {
    const s = new HintScheduler();
    expect(run(s, 3000, 5000, () => ({ flip: true }), () => true)).toEqual([]);
    expect(run(s, 5016, 6000, () => ({ hop: true, flip: true }), () => true)[0]).toMatchObject({ id: 'hop' });
  });

  test('complete() hides immediately, below minMs, and the hint never returns', () => {
    const s = new HintScheduler();
    run(s, 3000, 3100, () => ({ hop: true }));
    expect(s.currentId).toBe('hop');
    expect(s.complete('hop', 3200)).toEqual([{ id: 'hop', show: false }]);
    expect(run(s, 3216, 9000, () => ({ hop: true }))).toEqual([]);
    expect(s.complete('hop', 9100)).toEqual([]);
  });

  test('done ids from storage never show; perRun caps repeats', () => {
    const s = new HintScheduler({ done: new Set(['flip']) });
    const log = run(s, 3000, 40000, () => ({ flip: true, tuck: true }));
    expect(log.some((e) => e.id === 'flip')).toBe(false);
    expect(log.filter((e) => e.show && e.id === 'tuck').length).toBe(1);
  });

  test('trigger that goes false then true again re-arms a timed-out hint', () => {
    const s = new HintScheduler();
    const log = run(s, 3000, 20000, (t) => ({ flip: (t % 8000) < 6500 }));
    expect(log.filter((e) => e.show && e.id === 'flip').length).toBeGreaterThanOrEqual(2);
  });
});
