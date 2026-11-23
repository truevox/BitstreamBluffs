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
/**
 * #236: source-anchored revision-6 recording definitions. Historical tapes MUST
 * continue to use FIXTURES unchanged. In revision 6 the original Kodiak route
 * dies at 432 m, before the first pack spawns at 450 m. A QA seed sweep found
 * CE120-KODIAK-B reaches 1,192 m and yields 1,292 active-bear ticks; use that
 * route only for CE_FIXTURE_SET=sim6, preserving the historical original seed.
 */
export const FIXTURES_SIM6 = Object.freeze(FIXTURES.map((fixture) =>
  fixture.id === 'kodiaks-on'
    ? { ...fixture, seed: 'CE120-KODIAK-B', covers: [
      'SIM_REVISION 6 actual Kodiak pack activity (>= 1,000 active-bear ticks)',
      'at least one 450 m encounter, rider continues beyond 1,000 m',
    ] }
    : fixture));

// Gym (BSOD Gym) is NOT tape-covered: RunScene never creates a GhostRecorder in the Gym, so no replay fixture exists for it.
