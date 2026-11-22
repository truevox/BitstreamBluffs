/** #71: v1 local candidate constraints on recorded input requests, not executed moves. */
import { TapePlayer } from '../../src/systems/ghost/GhostTape.js';
import { validateAirtimeTape } from './replay-airtime.js';

export const DEFAULT_HOP_EDGE_BUDGET = 2;
export const MAX_HOP_EDGE_BUDGET = 120;
const channels = ['hop', 'parachute'];
const count = () => ({ heldTicks: 0, pressEdges: 0, requestedTicks: 0 });

export function hopEdgeBudget(value = `${DEFAULT_HOP_EDGE_BUDGET}`) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,2})$/.test(value) || Number(value) > MAX_HOP_EDGE_BUDGET) {
    throw new RangeError('Hop edge budget must be a whole number from 0 to 120');
  }
  return Number(value);
}

/** Decode via the production sparse-tape semantics. Caller verifies this same tape in the browser before export. */
export function evaluateInputConstraints(tape, budget = DEFAULT_HOP_EDGE_BUDGET) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > MAX_HOP_EDGE_BUDGET) {
    throw new RangeError('Hop edge budget must be a whole number from 0 to 120');
  }
  validateAirtimeTape(tape);
  const player = new TapePlayer(tape);
  const observed = { hop: count(), parachute: count() };
  // RunScene consumes the normalized pad and the recorder logs it before
  // stepping. Fatal input is consumed at endTick + 1 without a checkpoint.
  for (let tick = 1; tick <= tape.endTick + 1; tick++) {
    const pad = player.padAt(tick);
    for (const name of channels) {
      const held = pad[name] === true, pressed = pad.pressed[name] === true;
      if (held) observed[name].heldTicks++;
      if (pressed) observed[name].pressEdges++;
      if (held || pressed) observed[name].requestedTicks++;
    }
  }
  const rule = (id, input, metric, max) => ({ id, version: 1, input, metric, max, met: observed[input][metric] <= max });
  return {
    observed,
    candidates: [
      rule('no-hop-request', 'hop', 'requestedTicks', 0),
      rule('no-parachute-request', 'parachute', 'requestedTicks', 0),
      rule('hop-edge-budget', 'hop', 'pressEdges', budget),
    ],
  };
}
