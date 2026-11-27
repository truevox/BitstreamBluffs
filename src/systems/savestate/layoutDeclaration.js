/**
 * #424 — declared local savestate candidate-envelope layout.
 *
 * This descriptor binds the source/section inventory into currentBuildId.
 * It does not enable player save/load, grant rank/Verified status, or
 * validate/activate a live Matter scene. Those are separate gates.
 */
export const SAVESTATE_LAYOUT_DECLARATION_VERSION = 2;
export const CANDIDATE_SECTION_KEYS=Object.freeze([
 'clock','rng','recorder','terrain','matter','entities','subsystems','remainder',
]);
export const SAVESTATE_LAYOUT_DESCRIPTOR=Object.freeze({
 version:SAVESTATE_LAYOUT_DECLARATION_VERSION,
 sections:Object.freeze({
  candidate:Object.freeze({
   kind:'bb-internal-candidate-file',
   version:1,
   header:Object.freeze(['kind','version','runId','tick','buildId','rulesetId',
    'simRevision','seed','sections','integrity']),
   sections:CANDIDATE_SECTION_KEYS,
   integrity:'sha256-over-canonical-unsigned-file',
   identity:'exact-build-ruleset-sim-version-seed-tick',
   constraints:'local-single-use-only-no-public-ranking-authority',
  }),
 }),
});