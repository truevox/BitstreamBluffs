# Physics time capsules: ruleset identity and archive policy (#123)

Status: implements Replay Contract v1 section 7 (`docs/replay/replay-contract-v1.md`). Nothing here changes physics, `RunRecord`, `SaveStore` ledger hashes (V1-V4) or `sanitizeRun`.

## Status: library-only

Nothing in gameplay, `RunRecord`, the SaveStore or any scoreboard imports these modules yet. The acceptance bullet "current scoreboard cannot silently mix versions" is delivered as a tested, pure helper (`rulesetScoreboard.js`), not as shipped behavior. The two-version proof (`tests/replay/rulesetTwoVersion.test.js`) covers selection and partition logic with a toy simulation; it does not run the real game under two rulesets, because the live simulation reads module globals and a ruleset cannot yet parameterize it.

## What exists

| Piece | Where |
|---|---|
| Ruleset document (`bb-ruleset` v1), `SIM_REVISION`, `rulesetId` | `src/systems/replay/ruleset.js` |
| Explicit export registry, non-sim key lists, pinned hidden literals | `src/systems/replay/rulesetRegistry.js` |
| `createRulesetRegistry`, `resolveVerifier`, outcome records | `src/systems/replay/rulesetVerifier.js` |
| `scoreboardKey`, partition/mix guards | `src/systems/replay/rulesetScoreboard.js` |
| Committed artifact, archive, tripwire, CLI | `tools/ruleset/` (`build-ruleset.mjs --check/--write/--attest`) |

## Policy

1. **Identities are immutable.** `rulesetId = sha256(canonical(ruleset document))`. A ruleset is never edited, even if it encodes a bug; a fix is a new document with a new id. Historical validity ("this run was legitimate under ruleset X") and current eligibility ("X is the ruleset the current board uses") are separate facts.
2. **Content-addressed archive.** `tools/ruleset/archive/<hex>.json` holds the canonical bytes of every ruleset, named by its own SHA-256 (so `sha256sum` reproduces the id). Tests fail if a file does not hash to its name or if the current ruleset has no archive file. `current.json` records the current id, byte length and `SIM_REVISION`. Manifests and tape digests are archived the same way (`<kind>/sha256/<hex>`) by whatever store holds evidence; that store is outside this PR.
3. **Verifier bundles are publisher-built and hash-allowlisted.** A bundle is archived only when code behavior diverges from what the current implementation can reproduce (a `SIM_REVISION` bump that a constants-only ruleset cannot express). Bundles are never uploaded by players, and **never executed from input**: `resolveVerifier` only selects a digest that is on the allowlist and present; it loads and runs nothing. Anything else is `refused: unknown-ruleset` or `refused: historical-verifier-required`. The current ruleset is never used as a fallback.
4. **Preservation is not execution.** Keeping a ruleset document or a bundle by hash is a promise about bytes. Whether an old bundle still runs on future browsers, operating systems or hardware (and who patches an old pinned runtime) is a separate, weaker promise that this repository does not make.
5. **No silent mixing.** Boards key on `rulesetId`. Only a `match` outcome from a named verifier under a named ruleset is board-eligible; legacy outcomes (`consistent-with`, `inconclusive-legacy`), refusals and divergences are not. A board spanning rulesets must be requested explicitly (`crossRulesetView`) and says so in its `kind`.
6. **Shop economy is identity.** `basePrice`/`priceScale` stay in the ruleset: `draftCost` prices Daily Draft loadouts with them, so Draft legality (competition identity) follows the id. Non-sim keys that are removed (display names, labels, lore, draw-only keys) are scoped per table, so they cannot hide a key read elsewhere.
7. **Outcome records carry no boolean `verified`**: `{outcome, verifiedUnder, verifierId, tapeDigest, manifestDigest, firstDivergence?}`; a record is a statement by a named verifier.

## Threat model (honest)

Everything here is computed by the client over client-supplied data. A player can edit a manifest or tape and recompute every digest: a local hash proves "these bytes are what was described", not "a human played this", not "this player owns those upgrades", and not that another browser engine reproduces the run (that is #120). None of it is anti-cheat. A public leaderboard needs server-held evidence and an independently run verifier; this work only makes the claim precise (which rules, which verifier) so that later work can be checked.

## Changing the simulation

- Changed a constant, content JSON or `SIM_REVISION`: the `rulesetId` changes; run `node tools/ruleset/build-ruleset.mjs --write` and commit the new archive file (old files stay).
- Changed causal code behavior (even a bug fix, even with no constant touched): **bump `SIM_REVISION` in the same PR**, then `--write` and `--attest "sim-revision-bumped: <what>"`.
- Edited a tripwire file without a behavior change: `--attest "no-behavior-change: <why>"`. The tripwire digest is not part of `rulesetId` (a refactor must not change identity) and is not a proof; it forces a human decision.
- A new exported constant in a causal module must be classified in `rulesetRegistry.js` (included at a path, or excluded with a reason) or assembly and tests fail. This now covers TerrainGenerator, HazardMotion, Kodiaks, PhysicsTuner, TrickTracker, BiomeEffects, Wards, BsodBluffTracker, ShardMagnet and the other registered modules. `tests/replay/rulesetCoverage.test.js` also walks the import graph from `RunScene.js`: every `src/systems` / `src/entities` module that exports a constant must be registered, extracted, or on `NON_CAUSAL_MODULES` with a reason.
- Modules that cannot be imported in node (`RunScene.js`, `Sled.js`, `TerrainMesh.js`, `Shard.js`) have their column-0 numeric constants read by source extraction (`SOURCE_EXTRACTS`: literal numbers, numeric arrays and flat number objects only; no eval, no import). `RunScene.js` is on the tripwire allowlist. Remaining gap, precisely: values that are computed (`Math.min(950, TIMING.crashToGameOverMs)`, `Math.PI / 180`), multi-line literals, and literals inside function bodies (Sled geometry and density, `expectedSpeedPxS` ramps, the `x > 480` start margin, Kodiak body box, RunScene's `sledBox` 36x30 and similar) are invisible to the id. `SIM_REVISION`, canaries (#117) and the tripwire are their only guard.
- Tripwire attestations have three categories, all with a mandatory free-text reason (`--attest "<category>: <reason>"`):
  - `no-behavior-change: <why>` for refactors and presentation edits.
  - `sim-revision-bumped: <what>`: accepted only if `SIM_REVISION` actually exceeds the previously committed artifact's.
  - `behavior-change-unreleased: <why>`: causal behavior changed inside a revision that has not been released. Valid only while `SIM_REVISION > LAST_RELEASED_SIM_REVISION` (in `ruleset.js`, today 0: no ruleset has shipped on main, so revision 1 may still change). The PR that releases a ruleset sets `LAST_RELEASED_SIM_REVISION = SIM_REVISION`; from then on a behavior change needs a real bump and this category is rejected.

## Owner decisions (not adopted here)

- **Retention horizon for historical verifiers.** Options: keep all ruleset documents forever (cheap, recommended as the floor) and choose separately for runnable bundles: (a) archive-only, no execution promise; (b) a time-limited execution window per ruleset; (c) indefinite support for published leaderboard seasons only; (d) a count-based window ("last N simulation versions"). A count of five was floated in the background design; it is a proposal, **not owner-approved**, and is not implemented.
- **Who maintains security patches** for any pinned old runtime, and where old bundles run (isolated, server-side, longer than on clients).
- **Q7: binding a ledger record to a ruleset.** Adding `rulesetId` to `RunRecord` needs a V5 ledger hash and a `sanitizeRun` whitelist change (today an unknown field is silently dropped). Not done; the local index (`runId` to evidence) remains the intended link.
- **Public eligibility rules** for retired rulesets (archived-valid, separate board, or verification no longer supported) once a public leaderboard exists.
