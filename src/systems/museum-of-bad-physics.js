import {openDownhillRunTrace} from "./downhill-run-strip.js";
// Static browser-safe snapshot of SIM_REVISION in replay/ruleset.js.
// Its parity is enforced by tests; do not import the game engine into this local tool.
const SIM_REVISION = 9;

export const MAX_GALLERY_FILES = 8;
export const MAX_GALLERY_BYTES = 8 * 1024 * 1024;
export const MAX_GALLERY_FILE_BYTES = 2 * 1024 * 1024;

const TITLE_MAX = 80;
const TITLE_RE = /^[A-Za-z0-9 _.\-—'’()\/:]+$/;

function boundedTitle(name) {
  if (typeof name !== "string" || !TITLE_RE.test(name)) return "Untitled";
  return name.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
}

function boundedCommentary() {
  return "Local recorded pose trace. Geometry only; no provenance, scoring or authenticity claims.";
}

export function openMuseumEntry(json, {name = "Untitled", currentRevision = SIM_REVISION} = {}) {
  if (typeof json !== "string") {
    throw new TypeError("Museum entry must be a JSON text file");
  }
  // UTF-8 length cannot be smaller than JS string length: reject giant input before allocation.
  if (json.length > MAX_GALLERY_FILE_BYTES) {
    throw new RangeError("Museum entry exceeds 2 MiB");
  }
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_GALLERY_FILE_BYTES) {
    throw new RangeError(`Museum entry exceeds ${MAX_GALLERY_FILE_BYTES / 1024 / 1024} MiB`);
  }

  let tape;
  try {
    tape = JSON.parse(json);
  } catch (_) {
    throw new TypeError("Museum entry is not valid JSON");
  }

  let trace;
  try {
    trace = openDownhillRunTrace(json);
  } catch (error) {
    throw error;
  }

  const poseCount = trace.count;
  const svg = trace.render();

  const simRevision = typeof tape.simRevision === "number" && tape.simRevision > 0 && Number.isSafeInteger(tape.simRevision) ? tape.simRevision : null;
  const physicsVersion = typeof tape.physicsVersion === "number" && tape.physicsVersion > 0 && Number.isSafeInteger(tape.physicsVersion) ? tape.physicsVersion : null;
  const rulesetId = typeof tape.rulesetId === "string" && /^sha256:[a-f0-9]{64}$/.test(tape.rulesetId) ? tape.rulesetId : null;

  const classification =
    simRevision !== null && Number.isSafeInteger(simRevision) && simRevision > 0 &&
    typeof currentRevision === "number" && Number.isSafeInteger(currentRevision) && currentRevision > 0
      ? simRevision < currentRevision ? "historical-claim"
        : simRevision === currentRevision ? "current-claim"
        : "future-claim"
      : "unknown";

  const title = boundedTitle(name);
  const commentary = boundedCommentary();

  return Object.freeze({
    title,
    commentary,
    byteLength: bytes,
    poseCount,
    svg,
    simRevision,
    physicsVersion,
    rulesetId,
    classification,
  });
}