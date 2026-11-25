// Shared fixtures for the #66 crash-coach tests. Tapes are recorded through the REAL GhostRecorder, so the rows have
// exactly the shape (every-tick edge rows, dedup of unchanged ticks) a live run produces.
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';

/**
 * @param {object} o
 * @param {number} o.endTick
 * @param {number[][]} [o.hops] [pressTick, releaseTick) pulses (release = first tick NOT held)
 * @param {number[][]} [o.tucks] same, for tuck
 * @param {number[][]} [o.corks] same, for corkscrew
 * @param {number[][]} [o.leans] [fromTick, toTick, tilt127]; tilt held on [from, to)
 */
export function makeTape({ endTick, hops = [], tucks = [], corks = [], leans = [], header = {} }) {
  const inPulse = (list, t) => list.some(([a, b]) => t >= a && t < b);
  const rec = new GhostRecorder({ seed: 'coach-seed', biomeMask: 0, mode: 'normal', ...header });
  for (let t = 1; t <= endTick; t++) {
    const hop = inPulse(hops, t);
    const lean = leans.find(([a, b]) => t >= a && t < b);
    rec.input(t, {
      push: true, hop, tuck: inPulse(tucks, t), corkscrew: inPulse(corks, t),
      tilt: lean ? lean[2] / 127 : 0, heli: 0,
      pressed: { hop: hop && !inPulse(hops, t - 1) },
    });
  }
  rec.lastTick = endTick;
  return rec.finish({ runId: 'r1', distanceM: 100, score: 1000 });
}

/** A tape whose run ends (crashes) at tick 1000, with a hop at 850, a lean change at 900 and a tuck at 950. */
export function standardTape(extra = {}) {
  return makeTape({
    endTick: 1000,
    hops: [[200, 215], [850, 866]],
    leans: [[900, 940, 127]],
    tucks: [[950, 975]],
    ...extra,
  });
}
