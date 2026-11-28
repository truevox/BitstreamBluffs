/** #126: compare matched synthetic hop-noise panels; never rerun or rank a course. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, TextDecoder, types } from 'node:util';
import { createDailyShortlist, validateFatiguePanel, MAX_PANEL_BYTES } from './daily-shortlist.js';

export const MIN_NOISE_PANELS = 2;
export const MAX_NOISE_PANELS = 8;
const PANEL_KEYS = ['kind', 'settings', 'summary', 'verify', 'results'];
const SETTINGS_KEYS = ['seeds', 'noiseSeed', 'policy', 'passDistanceM', 'maxSec', 'biomeMask', 'rule', 'hopLeadMs', 'profiles'];
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
const hasExactly = (obj, keys) => Boolean(obj) && Object.keys(obj).length === keys.length &&
  keys.every((key) => Object.hasOwn(obj, key));

function readPanel(bytes, buildCommit, index, fatigue = false) {
  const at = `Panel ${index + 1}`;
  if (!types.isUint8Array(bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_PANEL_BYTES) {
    throw new TypeError(`${at}: expected 1 byte to 4 MiB of local panel data`);
  }
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  let panel;
  try { panel = JSON.parse(decoder.decode(bytes)); }
  catch { throw new TypeError(`${at}: expected a UTF-8 JSON bot panel`); }
  let checked;
  try { checked = fatigue ? validateFatiguePanel(panel) : createDailyShortlist(panel, { sourceSha256, buildCommit }); }
  catch { throw new TypeError(`${at}: expected a complete ${fatigue ? 'fatigue v2' : 'classic v1'} bot panel with successful --verify`); }
  // Do not silently drop unrecognized settings that could make panels incomparable.
  if (!hasExactly(panel, PANEL_KEYS) || !hasExactly(panel.settings, fatigue ? [...SETTINGS_KEYS, 'fatigue'] : SETTINGS_KEYS)) {
    throw new TypeError(`${at}: unexpected ${fatigue ? 'fatigue v2' : 'classic v1'} panel fields`);
  }
  const { noiseSeed, ...matchedSettings } = checked.settings;
  // These are the only input identifiers that can make it to the report.
  if (!identifier.test(noiseSeed) || !matchedSettings.seeds.every((seed) => identifier.test(seed))) {
    throw new TypeError(`${at}: use simple course and reaction IDs (1–64 ASCII letters, digits, dots, underscores, or hyphens; start with a letter or digit)`);
  }
  const controls = new Map();
  for (const cell of panel.results) {
    if (cell.humanNoise.profile === 'ideal') controls.set(cell.seed, cell);
  }
  const rows = fatigue
    ? [...checked.matrix].map(([seed, byProfile]) => ({ seed, trials: [...byProfile.values()] }))
    : checked.seeds;
  const passing = new Map(rows.map(({ seed, trials }) =>
    [seed, new Set(trials.filter(({ outcome }) => outcome === 'pass').map(({ profile }) => profile))]));
  return { noiseSeed, matchedSettings, sourceSha256, controls, passing };
}

/** Parse and validate actual source bytes; the supplied build pin is an assertion, not authentication. */
export function compareNoiseSensitivity(panelBytes, { buildCommit } = {}) {
  if (typeof buildCommit !== 'string' || !/^[a-f\d]{40}$/i.test(buildCommit)) {
    throw new TypeError('Provide a full 40-hex Git commit for the common producing build');
  }
  if (!Array.isArray(panelBytes) || panelBytes.length < MIN_NOISE_PANELS || panelBytes.length > MAX_NOISE_PANELS) {
    throw new TypeError(`Provide ${MIN_NOISE_PANELS}–${MAX_NOISE_PANELS} classic bot panels`);
  }
  const panels = new Map();
  let settings, originalControls;
  for (let i = 0; i < panelBytes.length; i++) {
    const { noiseSeed, matchedSettings, sourceSha256, controls, passing } = readPanel(panelBytes[i], buildCommit, i);
    if (panels.has(noiseSeed)) throw new TypeError('Reaction seed labels must be distinct');
    if (i === 0) {
      settings = matchedSettings;
      originalControls = controls;
    } else {
      if (!isDeepStrictEqual(settings, matchedSettings)) {
        throw new TypeError(`Panel ${i + 1}: course seeds, profiles, and run settings must match apart from reaction seed`);
      }
      // Same pass count is not enough: compare every recorded ideal observation, keyed by course.
      for (const [seed, ideal] of originalControls) {
        if (!isDeepStrictEqual(ideal, controls.get(seed))) {
          throw new TypeError(`Panel ${i + 1}: recorded ideal control differs for a matched course`);
        }
      }
    }
    panels.set(noiseSeed, { sourceSha256, passing });
  }

  const labels = [...panels.keys()].sort();
  const profileNames = Object.keys(settings.profiles);
  const courseCount = settings.seeds.length;
  const profiles = profileNames.map((profile) => {
    const passCounts = new Map(labels.map((label) => [label, 0]));
    const flips = [];
    for (const courseSeed of settings.seeds) {
      const passNoiseSeeds = labels.filter((label) => panels.get(label).passing.get(courseSeed).has(profile));
      for (const label of passNoiseSeeds) passCounts.set(label, passCounts.get(label) + 1);
      if (passNoiseSeeds.length > 0 && passNoiseSeeds.length < labels.length) {
        flips.push({ courseSeed, passNoiseSeeds });
      }
    }
    return {
      profile,
      counts: labels.map((noiseSeed) => {
        const pass = passCounts.get(noiseSeed);
        return { noiseSeed, pass, nonPass: courseCount - pass };
      }),
      flips,
    };
  });
  return {
    kind: 'local-noise-seed-sensitivity', version: 1,
    scope: 'descriptive offline synthetic bot observations only; not a Daily selection, ranking, or human fairness estimate',
    provenance: {
      assertedGitCommit: buildCommit.toLowerCase(), buildVerified: false,
      panelVerification: 'runner-reported seeded repeat and input playback, not rerun or authenticated here',
    },
    matched: { courseCount, passDistanceM: settings.passDistanceM, maxSec: settings.maxSec },
    sources: labels.map((noiseSeed) => ({ noiseSeed, sha256: panels.get(noiseSeed).sourceSha256 })),
    profiles,
  };
}


// Only these format-specific fields may differ in the unaffected ideal control.
function normalizeFatigueIdeal(cell) {
  const { humanNoise: { stats: { fatigue, ...stats }, ...noise }, ...rest } = cell;
  return { ...rest, humanNoise: { ...noise, version: 1, stats } };
}

/** Paired synthetic classic-v1 vs fatigue-v2 report; both inputs are required. */
export function compareFatiguePair(classicBytes, fatigueBytes, { buildCommit } = {}) {
  if (typeof buildCommit !== 'string' || !/^[a-f\d]{40}$/i.test(buildCommit)) {
    throw new TypeError('Provide a full 40-hex Git commit for the common producing build');
  }
  const classic = readPanel(classicBytes, buildCommit, 0);
  const fatigue = readPanel(fatigueBytes, buildCommit, 1, true);
  const { noiseModelVersion, frameHz, tickHz, ...settings } = classic.matchedSettings;
  if (classic.noiseSeed !== fatigue.noiseSeed || !isDeepStrictEqual(settings, fatigue.matchedSettings)) {
    throw new TypeError('Course seeds, reaction seed, profiles, and run settings must match apart from fatigue');
  }
  for (const [seed, ideal] of classic.controls) {
    if (!isDeepStrictEqual(ideal, normalizeFatigueIdeal(fatigue.controls.get(seed)))) {
      throw new TypeError('Recorded ideal control differs for a matched course');
    }
  }

  return {
    kind: 'local-noise-fatigue-pair', version: 1,
    scope: 'descriptive offline synthetic bot observations only; not a Daily selection, ranking, or human fatigue estimate',
    provenance: {
      assertedGitCommit: buildCommit.toLowerCase(), buildVerified: false,
      panelVerification: 'runner-reported seeded repeat and input playback, not rerun or authenticated here',
    },
    matched: { courseCount: settings.seeds.length, noiseSeed: classic.noiseSeed,
      passDistanceM: settings.passDistanceM, maxSec: settings.maxSec },
    sources: { classicSha256: classic.sourceSha256, fatigueSha256: fatigue.sourceSha256 },
    profiles: Object.keys(settings.profiles).map((profile) => {
      const counts = { bothPass: 0, classicOnly: 0, fatigueOnly: 0, neitherPass: 0 };
      const flips = [];
      for (const courseSeed of settings.seeds) {
        const a = classic.passing.get(courseSeed).has(profile);
        const b = fatigue.passing.get(courseSeed).has(profile);
        counts[a ? (b ? 'bothPass' : 'classicOnly') : (b ? 'fatigueOnly' : 'neitherPass')]++;
        if (a !== b) flips.push({ courseSeed, passedIn: a ? 'classic' : 'fatigue' });
      }
      return { profile, counts, flips };
    }),
  };
}
