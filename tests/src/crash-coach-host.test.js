/** #66: the scene host (launches the hidden RunScene beside Game Over) and the Game Over key guards, on fake scenes. */
import { jest } from '@jest/globals';
const { createSceneHost } = await import('../../src/ui/CrashCoachHost.js');
const { CoachCancelled } = await import('../../src/systems/coach/EngineSimulator.js');
const { coachKeyAllowed, coachHintVisible } = await import('../../src/ui/CrashCoachHook.js');
const { takeoverKeyAllowed } = await import('../../src/ui/TakeoverHook.js');

/** A host scene whose update() "processes the Phaser queue": launches become a RunScene with the coachSim data, stops remove it. */
function fakeScene({ failToStart = false } = {}) {
  const queue = [];
  const handlers = [];
  let run = null;
  const log = [];
  const scene = {
    events: { once: (e, fn) => { if (e === 'update') handlers.push(fn); }, off() {} },
    scene: {
      get: () => run,
      stop: (k) => { log.push(['stop', k]); queue.push({ op: 'stop' }); },
      launch: (k, data) => { log.push(['launch', k, data]); queue.push({ op: 'launch', data }); },
    },
  };
  const tick = () => {
    for (const q of queue.splice(0)) {
      if (q.op === 'stop') run = null;
      else if (!failToStart) run = { coachSim: { token: q.data.coachSim.token, created: true, live: q.data.coachSim.live }, sys: { isActive: () => !!run } };
    }
    for (const h of handlers.splice(0)) h();
  };
  return { scene, tick, log, run: () => run };
}
const drive = async (fake, p) => { let done = false; p.then(() => { done = true; }, () => { done = true; }); for (let i = 0; i < 300 && !done; i++) { fake.tick(); await Promise.resolve(); await Promise.resolve(); } return p; };

describe('createSceneHost', () => {
  test('acquire launches RunScene BESIDE the host with the coachSim descriptor in scene data and returns it once created', async () => {
    const f = fakeScene();
    const host = createSceneHost(f.scene);
    const tape = { x: 1 };
    const run = await drive(f, host.acquire(tape));
    expect(run.coachSim.created).toBe(true);
    const launch = f.log.find((l) => l[0] === 'launch');
    expect(launch[1]).toBe('RunScene');
    expect(launch[2].coachSim).toMatchObject({ kind: 'bb-coach-sim', tape, token: 1 });
    expect(launch[2].coachSim.live).toBe(host.live);
    expect(f.log.some((l) => l[0] === 'start')).toBe(false); // never scene.start: Game Over must not be stopped
    expect(f.log.findIndex((l) => l[0] === 'stop')).toBeLessThan(f.log.findIndex((l) => l[0] === 'launch')); // fresh scene each time
  });
  test('every acquire is a fresh token (a stale scene is never mistaken for the new one)', async () => {
    const f = fakeScene();
    const host = createSceneHost(f.scene);
    await drive(f, host.acquire({}));
    host.release(f.run());
    f.tick();
    const second = await drive(f, host.acquire({}));
    expect(second.coachSim.token).toBe(2);
  });
  test('dispose cancels the shared descriptor, stops the scene and resolves once it is gone', async () => {
    const f = fakeScene();
    const host = createSceneHost(f.scene);
    await drive(f, host.acquire({}));
    const disposed = host.dispose();
    await drive(f, disposed);
    const stops = f.log.filter(l => l[0] === 'stop').length;
    expect(host.dispose()).toBe(disposed);
    host.release({ coachSim: { live: host.live, token: 1 } });
    expect(f.log.filter(l => l[0] === 'stop')).toHaveLength(stops);
    expect(host.live.cancelled).toBe(true);
    expect(f.run()).toBeNull();
    await expect(host.acquire({})).rejects.toBeInstanceOf(CoachCancelled);
  });
  test('NEGATIVE CONTROLS: a host that is cancelled while waiting rejects; a scene that never starts rejects instead of hanging', async () => {
    const f = fakeScene();
    let cancel = false;
    const host = createSceneHost(f.scene, { isCancelled: () => cancel });
    const p = host.acquire({});
    cancel = true;
    await expect(drive(f, p)).rejects.toBeInstanceOf(CoachCancelled);
    const g = fakeScene({ failToStart: true });
    const h2 = createSceneHost(g.scene);
    await expect(drive(g, h2.acquire({}))).rejects.toThrow(/did not start/);
  });
  test('a timer backs up the frame wait, so a host scene that stopped updating cannot hang the search', async () => {
    jest.useFakeTimers();
    const f = fakeScene();
    const host = createSceneHost(f.scene);
    const p = host.frame();
    jest.advanceTimersByTime(300);
    await expect(p).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});

describe('key guards', () => {
  const idle = {};
  test('C is allowed exactly when Game Over is idle, and T is blocked while the coach is open', () => {
    expect(coachKeyAllowed(idle)).toBe(true);
    for (const k of ['takeoverPicker', 'coachView', 'leaving', 'entry', 'shopOpen', 'ghostView']) expect(coachKeyAllowed({ [k]: {} })).toBe(false);
    expect(takeoverKeyAllowed({ coachView: {} })).toBe(false);
    expect(takeoverKeyAllowed(idle)).toBe(true);
  });
  test('the hint stays visible while the coach itself is open, and hides during initials entry', () => {
    expect(coachHintVisible({ coachView: {} })).toBe(true);
    expect(coachHintVisible({ entry: {} })).toBe(false);
  });
});
