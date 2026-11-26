/**
 * #67: the UI-free half of CREATING a postcard at the takeover READY screen, plus LOCAL copy / save. NO Phaser, NO network,
 * NO storage: the clipboard and the file download go through injected `navigator` / `document` objects, nothing is uploaded,
 * and the only persistence is the file the player explicitly saves.
 */
import { REG } from '../../constants.js';
import { SIM_REVISION } from './ruleset.js';
import { CURRENT_RULESET_ID } from './currentRulesetId.js';
import { BUILD_ID_KEY } from './evidenceCapture.js';
import { createPostcard, encodePostcard, MIN_WINDOW_TICKS, MAX_WINDOW_TICKS } from './Postcard.js';
import { readChallenge, liveFingerprint, describeChallenge } from './PostcardChallenge.js';
import { POSTCARD_SOURCE } from './Takeover.js';
import { SIM_TICK_HZ } from '../SimClock.js';
import packageInfo from '../../../package.json';

export const POSTCARD_EXT = '.bbpostcard';
export const DEFAULT_WINDOW_SEC = 8;
export const WINDOW_RANGE_SEC = Object.freeze([MIN_WINDOW_TICKS / SIM_TICK_HZ, MAX_WINDOW_TICKS / SIM_TICK_HZ]);

const fail = (reason, message) => ({ ok: false, reason, message });

/** The identity of the RUNNING build as the postcard codec wants it. `buildId` is null until the async ruleset loader finished. */
export function currentPostcardIdentity(registry) {
  const b = registry && registry.get ? registry.get(BUILD_ID_KEY) : null;
  return { gameVersion: packageInfo.version, simRevision: SIM_REVISION, rulesetId: CURRENT_RULESET_ID, buildId: typeof b === 'string' ? b : null };
}

/**
 * Make a postcard from a RunScene frozen at takeover READY, where the authoritative state at tick N is live: the fingerprint and
 * the challenge summary are read straight from the sim. A postcard-sourced takeover cannot be re-shared (its tape holds only the
 * prefix); the original code is still the right thing to pass on.
 * @param {object} run the RunScene
 * @param {{windowSec?:number, codec?:object}} [o]
 * @returns {Promise<{ok:true, postcard:object, code:string}|{ok:false, reason:string, message:string}>}
 */
export async function shareFromReady(run, o = {}) {
  try {
    const t = run && run.takeover;
    const d = t && t.descriptor;
    if (!t || !d || t.phase !== 'ready' || d.source === POSTCARD_SOURCE || run.simClock.tick !== d.tick) return fail('not-ready', 'a postcard can be made only at the READY screen of a takeover of your own run');
    const identity = currentPostcardIdentity(run.registry);
    if (typeof identity.buildId !== 'string') return fail('identity', 'this build has no complete identity yet; try again in a moment');
    // The null-buildId fill is only for the tape this build recorded itself: the run that was just played.
    const last = run.registry.get(REG.LAST_GHOST_TAPE);
    const inSessionTape = !!(last && typeof last.runId === 'string' && last.runId === d.tape.runId);
    const made = createPostcard({ tape: d.tape, startTick: d.tick, windowSec: o.windowSec, fingerprintAtStart: liveFingerprint(run), challenge: readChallenge(run), identity, inSessionTape });
    if (!made.ok) return made;
    const code = await encodePostcard(made.postcard, o.codec ? { codec: o.codec } : {});
    return { ok: true, postcard: made.postcard, code };
  } catch (e) {
    return fail(e && e.code ? e.code : 'error', String((e && e.message) || e));
  }
}

/** `postcard-<12 hex of the digest>.bbpostcard` */
export const shareFilename = (pc) => `postcard-${pc.digest.slice(7, 19)}${POSTCARD_EXT}`;

/** Plain-language lines for the postcard view: the moment, the window, and the unranked notice. */
export function shareLines(pc) {
  return [`MOMENT AT ${(pc.startTick / SIM_TICK_HZ).toFixed(1)} S   WINDOW ${pc.windowTicks / SIM_TICK_HZ} S`, ...describeChallenge(pc.challenge), 'UNRANKED PRACTICE: NOT LEADERBOARD ELIGIBLE'];
}

/** Copy to the clipboard (local). @param {{clipboard?:{writeText:function(string):Promise<void>}}} [nav] */
export async function copyText(text, nav) {
  try {
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return fail('no-clipboard', 'clipboard not available; select the code and copy it by hand');
    await nav.clipboard.writeText(String(text));
    return { ok: true };
  } catch (e) {
    return fail('clipboard-denied', 'the browser refused the copy; select the code and copy it by hand');
  }
}

/** Save `text` as a local download (a Blob object URL and a clicked link). @param {{document?:object, URL?:object, Blob?:Function}} [env] */
export function saveFile(text, filename, env = {}) {
  try {
    const { document: doc, URL: urlApi, Blob: BlobCtor } = env;
    if (!doc || !urlApi || !BlobCtor || typeof urlApi.createObjectURL !== 'function') return fail('no-download', 'saving files is not available here');
    const url = urlApi.createObjectURL(new BlobCtor([String(text)], { type: 'text/plain;charset=utf-8' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    if (a.style) a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    if (typeof a.remove === 'function') a.remove();
    urlApi.revokeObjectURL(url);
    return { ok: true };
  } catch (e) {
    return fail('download-failed', String((e && e.message) || e));
  }
}
