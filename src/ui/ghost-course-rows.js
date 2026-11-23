/** Read-only Game Over labels for the existing local ghost roles. */
import { FAVORITE_SLOTS, tapeCompatible } from '../systems/ghost/GhostLibrary.js';
import { SIM_REVISION } from '../systems/replay/ruleset.js';
import { fmtInt } from './Format.js';

export const GHOST_COURSE_ROWS = Object.freeze([
  Object.freeze({ role: 'best', label: 'BEST', globalKey: 'ghostBest' }),
  Object.freeze({ role: 'latest', label: 'LATEST', globalKey: 'ghostLatest' }),
  ...Array.from({ length: FAVORITE_SLOTS }, (_, slot) => Object.freeze({
    role: `fav${slot}`, label: `FAV ${'ABC'[slot]}`, slot,
  })),
]);

function savedRunLabel(tape) {
  if (!Number.isFinite(tape?.distanceM) || tape.distanceM < 0) return 'SAVED RUN';
  const distance = `${fmtInt(tape.distanceM)} M`;
  if (!Number.isFinite(tape.endedAt) || tape.endedAt <= 0) return distance;
  const d = new Date(tape.endedAt);
  return Number.isNaN(d.getTime()) ? distance : `${distance}  ${d.getMonth() + 1}/${d.getDate()}`;
}

/** Read the existing roles of this exact seed and biome mask; no writes or replay checks. */
export async function readGhostCourseRows(library, current, settings = {}) {
  const course = library.course(current.seed, current.biomeMask);
  const ids = GHOST_COURSE_ROWS.map(({ role, slot }) =>
    (slot === undefined ? course?.[role] : course?.favorites?.[slot]) || null);
  const tapes = new Map(await Promise.all([...new Set(ids.filter(Boolean))].map(async (id) =>
    [id, await library.getTape(id)])));
  return GHOST_COURSE_ROWS.map(({ role, slot, globalKey }, i) => {
    const id = ids[i], tape = tapes.get(id);
    // Match RunScene's current-terrain display gate. Direct tape access and
    // historical replay compatibility are independent of this label.
    const compatible = tapeCompatible(tape) && tape.simRevision === SIM_REVISION;
    const hasTrace = compatible && tape.trace.length > 0;
    const currentRun = id !== null && id === current.runId;
    const shared = hasTrace && ids.some((other, j) => j !== i && id === other);
    const globalOff = globalKey !== undefined && settings[globalKey] === false;
    return {
      info: !id ? 'EMPTY' : !tape ? 'TAPE MISSING' : !compatible ? 'INCOMPATIBLE' : !hasTrace ? 'NO TRACE' : currentRun ? 'THIS RUN' : savedRunLabel(tape),
      shared,
      globalOff,
      on: course?.show?.[role] !== false,
      saveLabel: slot === undefined ? null : currentRun ? 'CLEAR' : id ? 'REPLACE' : 'SAVE',
    };
  });
}
