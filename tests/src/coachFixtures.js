// Shared fixtures for the #66 crash-coach tests. Tapes are recorded through the REAL GhostRecorder, so the rows have
// exactly the shape (every-tick edge rows, dedup of unchanged ticks) a live run produces.
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import { lastInputEdges } from '../../src/systems/coach/Perturb.js';

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

/** Words the coach must never use: it never claims its search is optimal or exhaustive. */
export const BANNED = /optimal|best possible|only way|guaranteed/i;

/**
 * A deterministic fake simulator. A candidate "survives" iff some hop press lands in [winLo, winHi]. It records its calls
 * so tests can check re-validation uses a fresh tape object. `flaky` makes it lie on the second call for a given tape.
 */
export function fakeSimulator({ winLo, winHi, crashTick = 1000, flaky = null, throwFor = null } = {}) {
  const calls = [];
  const seen = new Map();
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16); };
  const simulate = async (tape, { untilTick }) => {
    const key = JSON.stringify(tape.inputs);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    calls.push({ tape, untilTick, n });
    if (throwFor && throwFor(tape)) throw new Error('sim blew up');
    const presses = lastInputEdgesFor(tape, crashTick);
    let survived = presses.some((t) => t >= winLo && t <= winHi);
    let fp = hash(key + (survived ? 'S' : 'C'));
    if (survived && flaky === 'outcome' && n >= 2) survived = false;
    if (survived && flaky === 'fingerprint' && n >= 2) fp = `${fp}-other`;
    return {
      survived, crashTick: survived ? null : crashTick, cause: survived ? null : 'hazard',
      fingerprintAt: { [untilTick]: fp }, divergenceAt: presses.length ? Math.min(...presses) : null,
    };
  };
  return { simulate, calls };
}

function lastInputEdgesFor(tape, crashTick) {
  return lastInputEdges(tape, crashTick, 400).filter((e) => e.kind === 'hop' && e.action === 'press').map((e) => e.tick);
}
