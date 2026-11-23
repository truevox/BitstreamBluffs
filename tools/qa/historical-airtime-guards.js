/** #131: exact opt-in for one synthetic archived recording, not a general legacy tape reader. */
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const HISTORICAL_TAPE_SHA256 = '7875ffb782fe91686a99306e62c0ec44f7ff0b7c4c265bdca1cdab50c81360a9';
export const HISTORICAL_TAPE_BYTES = 9422;

export function validatePinnedHistoricalAirtimeTape(bytes) {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== HISTORICAL_TAPE_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== HISTORICAL_TAPE_SHA256) {
    throw new Error('Use the exact committed synthetic collision-heavy fixture.');
  }
  const tape = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // This intentionally describes the older native contract. It neither rewrites
  // the tape header nor asks the current game's validator to accept a legacy tape.
  if (tape.format !== 'bb-ghost-tape' || tape.version !== 1 || tape.physicsVersion !== 1 ||
      tape.mode !== 'normal' || tape.seed !== 'CE120-BUMP3' || tape.biomeMask !== 0 ||
      tape.dailyRuleId !== 'featherweight' || tape.controlLayout !== 'tricksRight' ||
      tape.simTickHz !== 120 || tape.kodiakVersion !== 2 || tape.kodiaksOn !== false ||
      tape.endTick !== 1668 || tape.inputs?.length !== 19 || tape.checkpoints?.length !== 13 ||
      !tape.checkpoints.every((row, i) => row.length === 8 && row[0] === (i + 1) * 120 &&
        row.every(Number.isFinite))) {
    throw new Error('Unexpected historical tape header or checkpoint cadence.');
  }
  return tape;
}
