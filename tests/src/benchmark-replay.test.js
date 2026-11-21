import { assertReplay, defaultTape, localUrl, replayFrames, replayKeys, summarize } from '../../tools/sim/benchmark-replay.mjs';
import { TapePlayer } from '../../src/systems/ghost/GhostTape.js';
import { SIM_TICK_HZ, SimClock } from '../../src/systems/SimClock.js';

test('the default uses a stable, bounded replay tape and one-shot inputs', () => {
  const tape = defaultTape();
  expect(defaultTape()).toEqual(tape);
  expect(tape.endTick).toBe(9 * SIM_TICK_HZ);
  const player = new TapePlayer(tape);
  const frames = Array.from({ length: tape.endTick }, (_, i) => player.padAt(i + 1));
  expect(frames[0].push).toBe(true);
  expect(frames[216].push).toBe(false);
  expect(frames.flatMap((pad, i) => pad.pressed.hop ? [i] : [])).toEqual([312, 708]);
  expect(tape.checkpoints).toEqual([]);
});

test('reported percentiles use nearest rank without changing the sample order', () => {
  const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
  expect(summarize(samples)).toEqual({ count: 100, totalMs: 5050, p95Ms: 95, p99Ms: 99 });
  expect(samples[0]).toBe(100);
  expect(summarize([0])).toEqual({ count: 1, totalMs: 0, p95Ms: 0, p99Ms: 0 });
  expect(() => summarize([NaN])).toThrow();
  expect(() => summarize([])).toThrow();
});

test('the benchmark refuses non-loopback origins and credentials', () => {
  expect(localUrl('http://127.0.0.1:8293/').port).toBe('8293');
  expect(localUrl('http://[::1]:8293/').hostname).toBe('[::1]');
  for (const bad of ['https://sledhead.ing/', 'http://localhost.example.org/', 'http://user@localhost/']) {
    expect(() => localUrl(bad)).toThrow(/loopback/);
  }
});

// Minimal fixed-tick scene contract. The real-browser benchmark makes the same
// reference/timed comparison with the production RunScene and TapePlayer.
function makeGame() {
  const body = { position: { x: 0, y: 1 }, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 };
  const run = {
    sled: { body }, score: { getTotal: () => body.position.x * 10 },
    simClock: new SimClock(), tapePlayer: new TapePlayer(defaultTape()),
    runRandom: { physicsScramble: { state: 42 } },
    simTick(dt, pad) {
      this.sled.body.position.x += dt + Number(pad.push);
      this.crashed = this.simClock.tick === 4;
    },
  };
  const schedule = [];
  const game = {
    scene: { getScene: () => run }, registry: { get: () => undefined },
    step(time, dt) {
      schedule.push([time, dt]);
      for (let n = run.simClock.advance(dt); n > 0; n--) {
        run.simTick(dt, run.tapePlayer.padAt(++run.simClock.tick));
      }
    },
  };
  return { game, run, schedule };
}

test('changing the measurement clock changes timing data but not tick schedule or result', () => {
  const first = makeGame();
  const reference = replayFrames({ tickLimit: 9, measure: false, keys: replayKeys }, first.game, () => {
    throw new Error('Reference must not read the measurement clock');
  });
  expect(reference.tick).toBe(4);
  expect(reference.crashed).toBe(true);
  expect(reference.tickTimes).toEqual([]);
  const timed = [1, 10_000].map((increment) => {
    const next = makeGame();
    const originalTick = next.run.simTick;
    let reading = 0;
    const result = replayFrames({ tickLimit: 9, measure: true, keys: replayKeys }, next.game, () => reading += increment);
    expect(next.run.simTick).toBe(originalTick);
    expect(next.schedule).toEqual(first.schedule);
    expect(result.states).toEqual(reference.states);
    expect(result.tickTimes).toEqual(Array(4).fill(increment));
    return result;
  });
  expect(summarize(timed[0].frameTimes)).not.toEqual(summarize(timed[1].frameTimes));
});

test('step failures restore the original tick method and do not report a partial result', () => {
  const { game, run } = makeGame();
  const originalTick = run.simTick;
  game.step = () => { throw new Error('failed frame'); };
  expect(() => replayFrames({ tickLimit: 9, measure: true, keys: replayKeys }, game)).toThrow('failed frame');
  expect(run.simTick).toBe(originalTick);
});

test('saved tape cannot pass on an early crash even if all earlier checks agree', () => {
  const tape = { checkpoints: [[2]] };
  const result = { tick: 4, crashed: true, checked: 1, savedRecord: false, droppedMs: 0, desync: null, states: [[]] };
  expect(() => assertReplay(result, tape, 5, false)).not.toThrow();
  expect(() => assertReplay(result, tape, 5, true)).toThrow(/without crashing/);
  expect(() => assertReplay(result, tape, 4, true)).toThrow(/without crashing/);
  expect(() => assertReplay({ ...result, tick: 5, crashed: false }, tape, 5, true)).not.toThrow();
});
