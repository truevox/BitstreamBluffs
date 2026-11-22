/** #78: developer-only validation and an allowlisted public shape for a local diagnostic. */
import { isDeepStrictEqual } from 'node:util';

const categories = new Set(['hazard', 'terrain', 'badLanding', 'chasm', 'bsod']);
// The committed crash-on-contact terrain hazard IDs. Kodiak, future, and
// custom IDs are deliberately omitted rather than copied into the report.
const publicHazards = new Set([
  'dewDrop', 'gearGate', 'glitchChasm', 'meteor', 'packetSpike', 'roguePacket', 'rollingBoulder', 'seagullDive',
]);

export class CrashBriefError extends Error {}

export function crashBriefBuildPin(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new CrashBriefError('Crash brief requires a full 40-hex Git build commit');
  }
}

export function checkFatalObservation(result, fatalTick, reference) {
  const event = result.fatalEvent;
  if (!result.crashed || result.tick !== fatalTick || result.fatalCount !== 1 || event?.tick !== fatalTick) {
    throw new CrashBriefError('Replay did not emit exactly one fatal crash on the expected tick');
  }
  if (!categories.has(event.cause) || ![event.x, event.y, event.speedPxS].every(Number.isFinite) ||
      event.speedPxS < 0 || (event.hazardId !== undefined && typeof event.hazardId !== 'string')) {
    throw new CrashBriefError('Replay emitted an unsupported fatal crash observation');
  }
  if (reference && !isDeepStrictEqual(event, reference.fatalEvent)) {
    throw new CrashBriefError('Fatal observations differed between fresh replays');
  }
}

// Call only after every replay, checkpoint and fatal observation has passed.
// Rebuild fields, never spread a tape, event, or arbitrary metadata.
export function crashBriefReport({ cause, hazardId }, freshRuns, checkpointsCheckedPerRun) {
  if (!categories.has(cause)) throw new CrashBriefError('Replay emitted an unsupported crash category');
  return {
    kind: 'local-replay-crash-brief',
    reportVersion: 1,
    scope: 'local unverified replay reproduction; not proof of the original crash',
    build: { sameBuildAsserted: true, independentlyVerified: false },
    replay: { freshRuns, checkpointsCheckedPerRun, matchedStateAndFatalEvent: true, savedRunsOrTapes: false },
    crash: { category: cause, ...(cause === 'hazard' && publicHazards.has(hazardId) ? { hazardId } : {}) },
  };
}
