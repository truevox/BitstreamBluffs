/* Fixture definitions for tools/conformance/cross-engine.mjs (issue #120).
 *
 * A fixture is recorded ONCE (Chromium, 120 Hz stepping, live autopilot input) with the game's own GhostRecorder; the
 * resulting tape is committed and every engine/cadence replays it through TapePlayer. The autopilot only exists at
 * recording time: the tape is the fixture. Diagnostic and non-authoritative; replaced by the #152 contract when published.
 *
 * Fields: id, seed (a `seed@mask` suffix selects biomes), style (autopilot, see page runtime), params, maxTicks,
 *         kodiaks (profile Sync Level 8 at record time so Kodiaks are on; replay is driven by the tape header),
 *         preRuns (consecutive other runs in the SAME browser page before the recorded one),
 *         covers (what the fixture is meant to exercise; stats in the result confirm it did).
 */
export const FIXTURES = [
  { id: 'cruise-baseline', seed: 'CE120-CRUISE', style: 'cruise', params: {}, maxTicks: 2400, covers: ['baseline grounded + air'] },
  { id: 'fifth-run-in-session', seed: 'CE120-FIFTH', style: 'cruise', params: { hopEvery: 300 }, maxTicks: 1800, preRuns: 4,
    covers: ['recorded as the 5th run in one page session; re-verified in a fresh browser context'] },
  { id: 'collision-heavy', seed: 'CE120-BUMP3', style: 'reckless', params: { hopEvery: 400 }, maxTicks: 2400, rngSeed: 9, covers: ['many contact pairs, hazards, hard landings'] },
  { id: 'chunk-biome-boundaries', seed: 'CE120-BIOME@4294967295', style: 'cruise', params: { tuck: true, vmax: 600 }, maxTicks: 5600,
    covers: ['crosses procedural chunk borders and the 500 m sector boundary (biome sectors from sector 2)'] },
  { id: 'bsod-pursuit-catch', seed: 'CE120-BSOD', style: 'bsod', params: { brakeAt: 300, resetEvery: 90 }, maxTicks: 14000,
    covers: ['BSOD pursuit; the rider brakes and spams manual reset (respawn) until the wall catches it (~100 s)'] },
  { id: 'airborne-tricks', seed: 'CE120-TRICKS', style: 'tricks', params: { hopEvery: 240 }, maxTicks: 3600, covers: ['heli / corkscrew / divebomb tricks'] },
  { id: 'parachute-airbrake', seed: 'CE120-CHUTE', style: 'chute', params: { hopEvery: 240 }, maxTicks: 3600, covers: ['parachute deploy, air brake presses, ground brake'] },
  { id: 'kodiaks-on', seed: 'CE120-KODIAK', style: 'cruise', params: { tuck: true }, maxTicks: 4800, kodiaks: true, covers: ['hostile Kodiak packs (Sync Level >= 6 at record time)'] },
  { id: 'daily-practice-rule', seed: 'daily-2026-11-14', style: 'cruise', params: {}, maxTicks: 2400,
    covers: ['Daily rule + biome mask derived from a past date seed (practice run; official Daily needs today\'s date)'] },
];
// Broader corpus added for #121 Phase B (not part of #120): other seeds, biome masks, styles and longer runs. Recorded with the portable-math build.
export const BROAD = [
  { id: 'broad-cruise-a', seed: 'PM121-A1', style: 'cruise', params: {}, maxTicks: 7000, covers: ['long cruise, default biomes'] },
  { id: 'broad-cruise-b', seed: 'PM121-A2', style: 'cruise', params: { tuck: true, vmax: 650 }, maxTicks: 8000, covers: ['long tucked cruise'] },
  { id: 'broad-cruise-c', seed: 'PM121-A3@1', style: 'cruise', params: { hopEvery: 500 }, maxTicks: 5000, covers: ['single-biome mask 1'] },
  { id: 'broad-cruise-d', seed: 'PM121-A4@2', style: 'cruise', params: { hopEvery: 350 }, maxTicks: 5000, covers: ['single-biome mask 2'] },
  { id: 'broad-cruise-e', seed: 'PM121-A5@64', style: 'cruise', params: {}, maxTicks: 5000, covers: ['single-biome mask 64'] },
  { id: 'broad-allbiomes', seed: 'PM121-A6@2047', style: 'cruise', params: { tuck: true }, maxTicks: 9000, covers: ['all biomes, long'] },
  { id: 'broad-reckless-a', seed: 'PM121-B1', style: 'reckless', params: { hopEvery: 300 }, maxTicks: 4000, rngSeed: 3, covers: ['hard contacts'] },
  { id: 'broad-reckless-b', seed: 'PM121-B2@4', style: 'reckless', params: { hopEvery: 450 }, maxTicks: 4000, rngSeed: 5, covers: ['hard contacts, biome mask 4'] },
  { id: 'broad-tricks-a', seed: 'PM121-C1', style: 'tricks', params: { hopEvery: 200 }, maxTicks: 5000, covers: ['heli/corkscrew/divebomb'] },
  { id: 'broad-tricks-b', seed: 'PM121-C2@8', style: 'tricks', params: { hopEvery: 260 }, maxTicks: 5000, covers: ['tricks, mask 8'] },
  { id: 'broad-chute-a', seed: 'PM121-D1', style: 'chute', params: { hopEvery: 200 }, maxTicks: 5000, covers: ['parachute and air brake'] },
  { id: 'broad-chute-b', seed: 'PM121-D2@16', style: 'chute', params: { hopEvery: 280 }, maxTicks: 5000, covers: ['parachute, mask 16'] },
  { id: 'broad-bsod-a', seed: 'PM121-E1', style: 'bsod', params: { brakeAt: 250, resetEvery: 120 }, maxTicks: 9000, covers: ['BSOD pursuit'] },
  { id: 'broad-kodiaks-a', seed: 'PM121-F1', style: 'cruise', params: { tuck: true }, maxTicks: 6000, kodiaks: true, covers: ['Kodiaks on'] },
  { id: 'broad-daily', seed: 'daily-2026-11-18', style: 'cruise', params: { hopEvery: 400 }, maxTicks: 5000, covers: ['daily rule from a past date seed'] },
];
// Gym (BSOD Gym) is NOT tape-covered: RunScene never creates a GhostRecorder in the Gym, so no replay fixture exists for it.
