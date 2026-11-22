# Replay Contract v1.1

Status: **Replay Contract v1.1, published 2026-11-21; normative; supersedes v1.0 (a5e7b47). The field lists in 6.3 are FINAL at the schema versions stated there (frozen; later changes need per-subsystem version bumps, section 9).** Author: CC Friday (Team A). Baseline: `origin/main` @ `b51ab36`. Implementation truth: #163 `aac32b4`, #165 `f3fc93d`, #166 `fc7f586`, #164 `4eaa371` (all draft PRs, not yet merged). Where this document and that code differ, the code was read and this text follows it. Audience: Team B (simulation behavior, browser/cross-engine conformance) and Team A implementers. Nothing here changes physics.

Posting note: ~136 K characters (about 37 K + 52 K + 46 K per part); GitHub comments hold 65,536 characters. Post as **3 comments**, split before section 4 and before section 7 (comment 1 = sections 0-3, comment 2 = sections 4-6, comment 3 = sections 7-11, appendices, changelog); the full file is committed as `docs/replay/replay-contract-v1.md` and is the authoritative copy. The self-contained v1.1 change list (BREAKING / NON-BREAKING) is the Changelog at the end and is also posted on its own.

Conventions: **VERIFIED** = read in code or executed. **UNVERIFIED** = inferred, or depends on something not inspected. MUST/SHOULD are normative. Vectors were computed by an independent scratch reference implementation (Node 22) and reproduced from this text alone by an independent reviewer; examples marked "implementation output" were produced by the #164/#166 code.

---

## 0. Status, identifiers, alignment

### 0.1 Identifiers

| Thing | Issue | PR (draft) | Owner |
|---|---|---|---|
| Contract foundation (canonical serializer, hash primitives, vectors) | #152 | #163 | Team A |
| Replay manifest | #116 | #164 | Team A |
| Subsystem frame fingerprints | #118 | #165 | Team A |
| Rulesets / time capsules | #123 | #166 | Team A |
| Golden canaries (consumes this contract) | #117 | #158 | Home Friday |
| Fair input timestamps | #115 | #162 | Team B |
| Savestate feasibility | #119 | #159 | Team B |
| Cross-engine conformance matrix (main consumer) | #120 | #161 | Team B |
| Sim/presentation causal isolation | #140 (leak #155) | #160 | Team B |
| Portable math (conditional) | #121 | none | Team B |

Contract identity strings (all lowercase ASCII): `bb-canonical-json` v1 (BB-CJSON), `bb-fp` v1 (frame fingerprint binary encoding), `bb-replay-manifest` v1, `bb-replay-evidence` v1, `bb-ruleset` v1, `bb-input-tape` v1, `bb-pad` input protocol v1. This document is "Replay Contract v1.0".

### 0.2 What was read

v1.0 was written when every PR was a starter stub. v1.1 reads the implementations (read-only): #163 canonical JSON/SHA-256/BB-FP primitives, #165 fingerprint schemas/capture/compare, #166 ruleset assembly/registry/verifier/scoreboard and `tools/ruleset`, #164 manifest/evidence store/live evidence path and the RunScene/GhostTape edits. Team B's PRs (#159-#162) and #158 remain starter stubs: alignment with them is by scope and plan only (Appendix A). Not independently verified here: behavior in a real browser (the #164 evidence-path timings below are the implementer's measurements), and anything outside `src/systems/replay`, `src/systems/ghost`, `src/scenes/RunScene.js` and `tools/ruleset`.

### 0.3 Verified conflicts with current code (things this contract has to work around or fix)

| # | Finding at `b51ab36` | Effect | Handling |
|---|---|---|---|
| C1 | `RunScene.create` (L196): `daily = seedDayInfo ? {rule} : DailyPatch.getDailyInfo()`. A non-`daily-YYYY-MM-DD` seed plays **today's UTC daily rule** (8-rule rotation, modifiers change gravity, friction, air control). `_ghostHeader` records `dailyRuleId` but nothing reads `replay.dailyRuleId`. | A normal-seed tape replayed on a different UTC day uses a different physics rule. Violates #116 acceptance "same tape reproduces across different wall-clock dates". | Manifest records the rule; **R-1** below requires replay to honor it. |
| C2 | `new BsodPursuit({ level: prof.level … })` reads the **live profile Sync Level**. Header has no level; replay does not override it. Level changes `wallX` (head start `900*log1p(level-1)`) and BSOD acceleration. | Same tape, different profile level, different BSOD wall. Violates "reproduces across profile upgrades". | Manifest records `syncLevel` plus the resolved initial BSOD state as check values; **R-2**. |
| C3 | Replay fallback: `replay.kodiaksOn` absent -> `kodiaksEnabledFor({level: prof.level})`. `magnetsDrop` same. Tapes recorded before Kodiaks (or before `magnetsDrop`) replay with **live** profile choice. `GHOST_PHYSICS_VERSION` stayed 1 across the Kodiak merge, and `tapeCompatible()` checks only format/version/tickHz/physicsVersion/`trace` (not `runRandomVersion`, not `kodiakVersion`). | Old tapes can silently replay with bears on. | Legacy mapping (section 5): all Kodiak fields absent => the `kodiak` module is omitted (bears off); absent `magnetsDrop` => `null`, strict verification refused. **R-3**. |
| C4 | `quantizeTilt(-0)` returns `-0` (VERIFIED by executing it); `encodePad` stores `[0,-0]`; `rec.input` dedupes with `===` so `-0` is stored only when a bit change coincides. `JSON.stringify` writes `-0` as `0`; IndexedDB structured clone keeps `-0`. | Live run used `-0` tilt; a replay from an exported/JSON tape uses `+0`. Impact on physics: UNVERIFIED (probably only zero-sign of results, but it is a free divergence source). | Normalize at record time (`tilt127 === 0 ? 0`), and in evidence projection (section 4.5). Legacy comparisons treat `±0` as equal. |
| C5 | `docs/issue-56-ghost-library.md` specs checkpoints with a 32-bit checksum and header fields `generatorVersion`, `actionSchemaVersion`, and `CourseKey` with `gen<N>`. **None exist in code.** | Spec drift; do not rely on the doc. | Contract supersedes the doc for evidence. |
| C6 | Header `startedAt` (ms wall clock), `runId = ${startedAt}-${seed}`, tape `endedAt`; `cause` always `'crash'` in tapes. | Privacy (section 1.3); `cause` not informative. | Manifest excludes them; claims carry `cause` from the record. |
| C7 | `Rng.js` `utf8Bytes` encodes a **lone surrogate as a 3-byte sequence**, not U+FFFD. Seeds are user-typed. | A seed with a lone surrogate hashes differently in any independent implementation and cannot be represented in canonical JSON. | v1: such seeds are **evidence-ineligible** (run plays; no manifest is produced). UI may sanitize later. |
| C8 | `GhostLibrary._collect` deletes a tape immediately when no role references it. | Evidence cannot live there. | Separate store (section 1.2). |
| C9 | `lastElapsed` in Matter `engine.timing` is `Common.now()` (wall clock). | Must never enter a fingerprint. | Explicit exclusion (section 6.3). |
| C10 | `Sled` body geometry/density (so `bounds.min.x`, the BSOD left edge), trick factors, and many magic numbers are literals inside functions, not exported constants; e.g. `TerrainGenerator` `options.screenWidthPx || 480` and `options.pxPerMeter || 20` (hidden literals; #166 pins both by source text and puts them in the ruleset). | A constants-only `rulesetId` cannot see them. | `SIM_REVISION` + canaries + source tripwire (section 7); known limit: in-function literals stay invisible to the id. |
| C12 | **Team B finding (#140/#160), not a Team A fix.** `RunScene.onSettingsChanged` calls `refreshPalette()` on a palette setting change, and `refreshPalette` re-adds every joined terrain chunk (`mesh.addChunk`, which removes and re-creates its Matter colliders). A mid-run palette toggle is a user action that is **not on the tape**. UNVERIFIED whether the rebuilt colliders change the trajectory (new bodies get new ids and detector order); if they do, such a run diverges from its replay, and `matter.staticOrder` / `terrain` fingerprints are the instruments that would show it. (A palette repaint on biome entry/exit is deterministic and on the tape.) | Possible hidden causal input. | Reported for #140/#160 to confirm or refute; not part of the contract's schema. |
| C11 | `GhostRecorder.input` dedupes identical consecutive rows (VERIFIED by executing: ticks 1-3 with a `hop` edge and unchanged held bits give **one** row `[1,4102,0]`; `TapePlayer` applies edges only on the row's exact tick, so ticks 2-3 lose the edge on replay). | Tapes with edges on consecutive ticks replay differently from the live run. | FIXED in #164 (`GhostRecorder.input` writes a row on every tick whose bits carry an edge bit, mask bits 12-17); the tape header gets `edgeRows:"every-tick"`, and `causal.input.edgeRows` records which behavior produced a tape (4.4 item 8). |

**Replay-resolution behavior (R-1..R-5): implemented in #164 (`4eaa371`).** These change what `RunScene.create` does **only when `_replayTape` is set**; live play is unchanged. Team A implements them (replay fidelity is #116 acceptance), confined to the replay-setup branch of `create()`; this is replay input resolution, not a simulation-behavior change, and the `update()` loop is untouched. They are realized by one pure function, `resolveReplaySetup(source, {rules})` (`source` = a manifest or a tape; returns the values below plus `defaulted: [...]`, 5.3):
- R-1: the daily rule comes from the recorded `dailyRuleId` (`"none"` = empty modifiers; an id absent from the rule table throws `unknown-daily-rule`), never from the clock (L196).
- R-2: `prof.level` is not read for the BSOD (`new BsodPursuit`, L391-393) or for `magnetsDropFor` (L228) / `kodiaksEnabledFor` (L231); the recorded Sync Level and Kodiak/magnet values are used.
- R-3: `kodiaksOn`/`kodiakPackMode`/`magnetsDrop` come from the manifest/tape; when a legacy tape lacks them the documented defaults of 5.3 apply (never the live profile).
- R-4: the live registry flags `REG.BSOD_GYM`, `REG.DAILY_OFFICIAL`, `REG.DAILY_MODE` are ignored while replaying (`bsodGym=false`, `dailyOfficial=false`, `dailyMode="classic"`).
- R-5: the recorder emits an edge row on every tick that has an edge bit (C11).
- **Known follow-up:** R-1 currently resolves the rule through the live `DailyPatch.RULES` table (`opts.rules`), not the ruleset's `tables.dailyRules`. They are equivalent at `SIM_REVISION` 1; the two must be tied together before a rule can change.

### 0.4 Team B alignment (summary; details in 6.9 and Appendix A)

No hard incompatibility with the Team B drafts exists today. Two adjacency risks, both avoidable: (a) #162 edits `RunScene.update`'s pad-generation lines (~L1218-1221) and `SimClock.padsFor`; our fingerprint hook lives **inside `GhostRecorder.afterTick`** (already called at L1230) and adds zero lines to `update()`. (b) Team A's RunScene edits (all in #164) are limited to `_ghostHeader`, the **replay-setup branch of `create()`** (R-1..R-4), and one deferred call in `_saveGhostTape`; #160's "minimal fixes in `src/**`" and #162 should avoid those regions or coordinate through #152.

---

## 1. Scope and non-claims

### 1.1 What these artifacts are

| Artifact | Purpose | Strength |
|---|---|---|
| Identity digests (`sha256:`) | Content-address manifests, rulesets, tapes, evidence bundles; detect accidental corruption and silent drift | Collision-resistant, **but computed by the client over client-supplied data** |
| Frame fingerprints (`xxh32x2:`) | Diagnose *where* two runs diverge | **Not collision-resistant against an adversary**; diagnostic only |
| Run-ledger hashes V1-V4 (existing, xxHash32) | Local record consistency | Unchanged, never rehashed, **not security** |

**Non-claims (normative; UI and docs MUST NOT contradict them):**
1. None of these is anti-cheat. A player can edit a manifest and recompute every digest. A matching digest proves "this byte string is what was described", not "a human played it".
2. A replay proves an input stream yields a score under a ruleset, not that a human pressed it (tool-assisted/AI classification is out of scope for v1).
3. "Verified" never appears as a boolean in a record; a verification outcome names the verifier (ruleset + verifier identity) that produced it (section 7.4).
4. Preservation is not execution: retaining a ruleset or a verifier bundle by content hash does not promise it will run on future hardware/browsers. Uploaded code is **never** executed.
5. Same-build, same-engine determinism is not cross-engine determinism. Cross-browser parity is #120's evidence to produce, not an assumption.
6. Entitlement (owning ranks/boosts) is not proven by a replay.

### 1.2 Disposable ghost cache vs durable evidence

| | Ghost cache (existing) | Replay evidence store (new) |
|---|---|---|
| Storage | IndexedDB `bitstream-ghosts` (`courses`, `tapes`) | **Separate database `bitstream-replay-evidence`** (not an object store inside `bitstream-ghosts`) |
| Contents | Tape incl. cosmetic `trace` (Float32 every 4 ticks), at most 5 roles/course | `bb-replay-evidence` bundle (manifest, inputs, checkpoints, claims); **no** pose trace |
| Lifecycle | `_collect` deletes unreferenced tapes immediately | **Never** touched by `GhostLibrary`; no auto-eviction; deletion only by explicit user action |
| Keyed by | `runId` | `bundleDigest` (content address). A local **index only** (`{digest, size, runId, seq}`) sits beside the bytes; `seq` is a local insertion counter, **no wall-clock value is stored anywhere**, and the index is never exported |
| Purpose | draw ghosts | re-verify, diagnose, export, submit |

Rules:
- Separation by database makes `_collect` unable to affect evidence by construction (a pin flag inside `tapes` would depend on every future GC path being correct).
- IndexedDB is **not permanent**: browser clearing, quota pressure, private windows and device loss destroy it. The store surfaces write failures (`put` rejects with `write-failed` / `quota-exceeded` and the bundle stays in memory for the session; `durable` is true only while IndexedDB is the backend and nothing is memory-only), requests `navigator.storage.persist()` **only on an explicit export** (never unasked), and provides export/import of the canonical bundle bytes (`.bbreplay`, file name = digest). **`importBundle` requires `expectedDigest`**: a structurally valid bundle with one flipped byte is a different, equally valid bundle, so the digest must come from the exporter.
- Evidence stays local unless the player exports or explicitly submits it. No automatic upload. Bazaar sharing (#58) is a separate explicit action with its own policy.
- Evidence size is **estimated, not measured**: ~4 KB of inputs per 3 minutes (docs/issue-56 estimate, UNVERIFIED) plus checkpoints: `combined`-only ~26 B/checkpoint (~4.7 KB per 3 min); `full` detail ~250 B/checkpoint (~45 KB per 3 min). Default policy: `combined`; canaries and bug-report exports use `full` (section 6.7).
- **Live path (VERIFIED in code; timings are the implementer's measurements, UNVERIFIED here).** After a crash, `RunScene._saveGhostTape` calls `scheduleRunEvidence`, which runs building, validation (once) and hashing in a later task (`setTimeout 0`), never on the crash frame: about 1.7-2.8 ms of crash-frame cost and 4-9 ms deferred. It reads only the finished tape and the recorder's already-captured fingerprints. It never throws; every failure goes to `console.warn` and to `registry['lastEvidenceStatus']` (`{ok, digest?, durable?, code?, message?}`); that status has **no UI consumer yet** (open item). The ruleset used is the **committed artifact** loaded by `runtimeRuleset.js` through a dynamic import (it uses Vite `import.meta.glob`, so Jest never loads it) and **re-hashed** against `tools/ruleset/current.json`; browsers do not re-assemble the ruleset because assembly reads source text (7.1).
- Public (server-side) evidence retention, redaction and append-only event logs are future work (#135) and out of scope.

### 1.3 Privacy: existing header fields

| Field (`_ghostHeader` / tape) | Concern | v1 manifest treatment |
|---|---|---|
| `startedAt`, `endedAt`, `runId` (embeds `startedAt` + `seed`) | Millisecond wall-clock "when did this person play"; behavioral timing | **Excluded.** Evidence is addressed by digest. A local index may keep `runId`; it is not exported by default. |
| `seed` | Required for replay. User-typed seeds can contain a name, handle or email | Included (causal). Export UI MUST show the seed before exporting. Cannot be redacted without changing the run. |
| `controlLayout` | Device-habit signal; not causal (the effect is already in `variableHop`/`noAutoNudge` input bits) | **Excluded** |
| `upgradeRanks`, `boosts`, new `syncLevel` | Reveal account progress | Included (causal); consent copy on export |
| Input timing (`inputs` rows: when keys change, to 8.3 ms resolution) | Keystroke-dynamics data: behavioral biometrics that can identify a person across sessions even without an account | Inherent to replay. Export/submission consent copy MUST say that inputs are personal behavioral data. |
| `bundleDigest`/`manifestDigest`/`tapeDigest` | A unique, stable identifier of one run; linkable wherever it is shared | Treated as personal-data-adjacent: never put in analytics/telemetry; included in consent copy. |
| Browser UA, OS, hardware | Fingerprinting | **Never** written to a manifest. Conformance harnesses record environment in their own result files. |
| `initials` (RunRecord) | PII-ish | Never in manifests or tapes (already not in tapes) |

A manifest contains no account, email, device or network identifier. Lone-surrogate seeds: see C7.

---

## 2. Canonical serialization: BB-CJSON v1

Goal: the **same bytes in every implementation**, so a SHA-256 over them is a stable identity. BB-CJSON v1 is a strict profile of RFC 8785 (JCS) with extra rejections. A value that is not representable is an **error, never silently altered**. Every escape and normalization example in this section is written with explicit escapes or hex bytes; no invisible or composed characters are used as examples.

### 2.1 Rules

| Topic | Rule | Why |
|---|---|---|
| Encoding | UTF-8, no BOM, no trailing newline. Implementations MUST NOT depend on `TextEncoder`/`TextDecoder` (absent in some Jest environments); UTF-8 is hand-rolled and strict (overlongs, surrogate code points, > U+10FFFF, truncated sequences => `invalid-utf8`). **Byte inputs** (`parseCanonical`, `sha256Hex`, `xxh32Bytes`, ...) accept only `Uint8Array` (including Node `Buffer` and cross-realm Uint8Arrays) and `ArrayBuffer`. Hashing functions throw a **`TypeError`** for anything else (`Int8Array`, `Uint8ClampedArray`, other typed arrays, `DataView`, strings, arrays), because hashing the wrong view would silently produce a wrong digest; `parseCanonical` reports other objects as `unsupported-type:object`. | |
| Whitespace | None anywhere | |
| Value types | `null`, `true`, `false`, string, number, array, plain object | |
| Rejected | `undefined` (anywhere, including array elements and object values), functions, symbols, BigInt, `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`, class instances, accessor properties, symbol keys, non-enumerable own properties, sparse arrays, arrays with extra properties. **Arrays are checked per index by property descriptor** (never `v[i]` on an unchecked slot, so a getter is never invoked): a hole is `sparse-array`, an accessor element `accessor`, a non-enumerable element `hidden-property`, each at `/<index>`. **`Proxy` objects cannot be detected from JavaScript** and are serialized as whatever their traps present; never pass an untrusted Proxy. | `JSON.stringify` silently drops/changes these; silent change = identity bug. Absent is not `null`: builders omit absent optional keys explicitly. |
| Plain object | prototype is `null`, **or** the prototype's own prototype is `null` and `Object.prototype.toString.call(v) === "[object Object]"` (cross-realm safe: an object from an iframe/VM context is accepted, a class instance is not). Arrays: `Array.isArray(v)` and a prototype chain of length exactly 2 (array prototype, then a prototype whose own prototype is `null`) with tag `[object Array]`. | |
| Object keys | Sorted by **UTF-16 code unit** order (JS default `Array.prototype.sort` on strings). Duplicate keys are impossible on output and **rejected on parse**. | JCS-compatible; JS's native order. |
| Key alphabet | v1 restricts every key to `^[A-Za-z0-9_.:$-]{1,64}$` and rejects `__proto__` | With ASCII-only keys, UTF-16 order = code point order = UTF-8 byte order, so ports to Rust/Go/Python cannot disagree on ordering (the only place the choice matters). Values may be any well-formed Unicode. |
| Strings | Escape exactly: U+0022 -> backslash-quote, U+005C -> two backslashes, U+0008/09/0A/0C/0D -> `\b \t \n \f \r`, every other U+0000-U+001F -> backslash-`u00xx` (**lowercase** hex). Everything else literal UTF-8, including U+007F, U+2028/2029 and `/`. No other `\u` escapes ever. Lone surrogate => `lone-surrogate`. UTF-8 length <= 1,048,576 bytes (`string-too-long`). **No Unicode normalization.** | Seeds are identity; normalizing would change terrain. |
| Integers | Safe integers only (`Number.isSafeInteger`), decimal, no `+`, no leading zeros, no exponent. Integer-valued floats (`3.0`, `1e3`) are integers. **`-0` is an error** (`negative-zero`), including when produced by parsing the text `-0`. | |
| Non-integer numbers | Finite; output is ECMAScript `Number::toString` (shortest round-trip digits); **rejected if the output contains `e`** (`float-out-of-range`; band `1e-6 <= abs(x) < 1e21`). `NaN` (`nan`), `±Infinity` (`infinity`): error. Integer-valued beyond 2^53-1: `unsafe-integer`. | RFC 8785's number rule, narrowed to the exponent-free band where non-JS implementations most often disagree. Decimal text is for **authored constants**; physics state uses `F64` (2.2). |
| Arrays | Order preserved | |
| Depth | A 33rd nested container (array or object, regardless of what it contains) => `too-deep`, pointer = that 33rd container (e.g. `/0` repeated 32 times); 32 nested containers are accepted | Parser safety |
| Size | Canonical output/input > 16,777,216 bytes => `too-large` | |
| Binary payloads | Never as typed arrays. By schema: standard base64 (RFC 4648, `=` padded) strings; decoders re-encode and reject non-canonical forms. Digests: lowercase hex. | Matches the existing `trace` encoding (`btoa`). |

### 2.2 Floats that carry physics state: `F64` hex, by schema

The serializer is generic; **schemas** decide where a float is an `F64`: the string `"f64:"` + 16 lowercase hex digits = IEEE-754 binary64 bits, **big-endian**. Use `F64` for every number that (a) comes out of the simulation (start pose, resolved BSOD state, checkpoint values, exact sled numbers, `claims.distanceExact`) or (b) is derived from arithmetic. `-0` and `±Infinity` are legal in `F64`; every NaN encodes as the canonical `f64:7ff8000000000000` (validators warn). `f64Encode` of a non-number is a `TypeError` (a programming error, not a CJSON code). `f64Decode` MUST re-encode and compare: uppercase digits, wrong length, missing prefix, or a NaN with other bits => `f64-noncanonical`. Plain decimals are allowed only for **authored constants** (ruleset), where the authored shortest literal is the identity, and for integers (ticks, counts, digests' lengths, integer scores).

Rationale: relying on `Number::toString` for authored constants is acceptable (spec-defined shortest, cross-engine; RFC 8785 has years of conformance); relying on it for *computed* physics state would mix "same bits" with "same text" and hide `-0`/NaN. Hex is exact, portable, and makes `-0` visible.

Every implementation MUST run the vector self-test at verifier start; an engine whose `Number::toString` differs fails loudly. The reference exports **`canonicalSelfTest()`** (checks `cj-003/006/007/008`, the exponent-free band, the float/integer rejections and the F64 helpers against the section 2.4 vectors, and throws on the first mismatch); `canonicalSha256.js` runs `sha256SelfTest()` (NIST vectors) at module load, so a wrong SHA-256 fails loudly at import. VERIFIED: all current constant tables (`PHYSICS`, `SCORING`, `TERRAIN`, `GLITCH`, `TUNING`, `BSOD_DEFAULTS`, `DailyPatch.RULES`, `BOOST_DEFS`, `UPGRADE_CATALOG`, exported numeric constants of TerrainGenerator/HazardMotion/Kodiaks) and all 72 `src/data/{chunks,hazards,powerups,terrainMods,biomes}/*.json` files **serialize under these rules unchanged**; no exponent-notation floats in `TUNING`. Node 22/V8 only; SpiderMonkey/JSC conformance is UNVERIFIED (#120 to show).

### 2.3 Canonical on-disk form, parsing, error precedence

Stored and transmitted evidence is **always canonical bytes**. A reader processes input in this fixed order and reports the **first offender in document order** within a stage:

1. Strict UTF-8 decode -> `invalid-utf8` (so invalid UTF-8 beats a BOM).
2. Leading BOM (EF BB BF) -> `bom`.
3. Input longer than 16,777,216 bytes -> `too-large` (right after the BOM check, before any parsing; also applied to serializer output).
4. Grammar and duplicate keys, in one pass -> `syntax-error` / `duplicate-key` (plain `JSON.parse` keeps the last duplicate, so two implementations could disagree; a hand-written or scanning parser is required). A syntax error or duplicate key wins over an earlier value-level offender.
5. Value-level rejections, first offender in document order: `negative-zero` (a parsed `-0`), `unsafe-integer`, `float-out-of-range`, `infinity`, `lone-surrogate`, `key-not-allowed`, `proto-key`, `too-deep`, `string-too-long`, ... (everything in 2.1 that is a property of the *value*).
6. Re-serialize and require **byte equality** with the input -> `not-canonical`. Token-level forms such as `1.0`, `1.50`, `1e2`, escaped `/`, an unnecessary `\u` escape, whitespace, unsorted keys, or a trailing newline are caught here.

Digests are taken over the received bytes only after stage 6 passes. Parsed objects SHOULD use `Object.create(null)`.

**Parser memory is bounded** under hostile nesting: the parser is iterative (no recursion, so depth cannot overflow the stack) and builds values only for the first 32 nesting levels; deeper levels (already a `too-deep` violation) cost one byte of type per level plus map entries only where a count or key exists, so `[` repeated 16 MiB costs tens of MiB, not gigabytes. Syntax and duplicate-key checking continue through the deep region, so the precedence above is preserved. Notes on the serializer: `canonicalize` validates **all keys of an object** (and symbol/hidden properties) before descending into values, so for `{a: undefined, "\u00e9": 1}` it reports `key-not-allowed`; the document-order rule of stage 5 is a `parseCanonical` property. `parseCanonical(string)` cannot see UTF-8, so a lone surrogate in a string input is the value-level `lone-surrogate`, not `invalid-utf8`.

Serializer-side value rejections additionally use: `undefined`, `unsupported-type:<typeof>`, `non-plain-object`, `non-plain-array`, `array-extra-props`, `sparse-array`, `symbol-key`, `accessor`, `hidden-property`.

**Error location** is an RFC 6901 JSON Pointer in the error's `pointer` field (root = the empty string; `~` -> `~0`, `/` -> `~1`; array indices decimal), e.g. `/causal/bsod/syncLevel`, `/a/1`. `$`-paths are not used. **Key-rule errors (`key-not-allowed`, `proto-key`) and `duplicate-key` point at the offending member itself**, not at its container: `/__proto__`, `/a` (the second `a`), `/a~1b` (key `a/b`), `/a~0b` (key `a~b`). A non-ASCII member pointer is UTF-8 bytes, so fixtures also carry `pointerHex`.

**Full error-code list (contract-stable):** `invalid-utf8, bom, syntax-error, duplicate-key, nan, infinity, negative-zero, unsafe-integer, float-out-of-range, undefined, unsupported-type:<typeof>, lone-surrogate, key-not-allowed, proto-key, non-plain-object, non-plain-array, array-extra-props, sparse-array, symbol-key, accessor, hidden-property, too-deep, string-too-long, too-large, not-canonical, f64-noncanonical`.

### 2.4 Worked examples (reference implementation output)

Inputs that contain control, invisible or non-ASCII characters are described by code point (`U+XXXX`) or name, never typed as raw characters or escapes; the **hex bytes are authoritative** (they are also in the fixtures). Text columns appear only for printable ASCII results.

| id | Input (JS) | Canonical bytes | SHA-256 |
|---|---|---|---|
| cj-001 | `{}` | text `{}` | `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` |
| cj-002 | `[]` | text `[]` | `sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| cj-003 | `{b:1,a:2,B:3,_:4,'10':5,'9':6,aa:7,'a.b':8,'a-b':9}` | text `{"10":5,"9":6,"B":3,"_":4,"a":2,"a-b":9,"a.b":8,"aa":7,"b":1}` | `sha256:e6ca48648a0463b55454e7ef751468c42bc6357832a26c78a0db9982434386db` |
| cj-004 | `{z:[3,1,2],a:{y:null,x:true,w:false}}` | text `{"a":{"w":false,"x":true,"y":null},"z":[3,1,2]}` | `sha256:2247629f1fbd78153e4d67314eaf96ac6bf9d3918d86213913bc63f5311ca241` |
| cj-005 | `{s: 'q' + QUOTE + 'b' + BACKSLASH + 'c/' + LF + TAB + CR + BS + FF + U+0001 + U+001F + U+007F + U+2028 + U+00E9 + U+1F600}` (named control characters, not escapes) | hex `7b2273223a22715c22625c5c632f5c6e5c745c725c625c665c75303030315c75303031667fe280a8c3a9f09f9880227d`. Reading it: `{"s":"q` + `\"` + `b` + `\\` + `c/` + `\n\t\r\b\f` + `\u0001\u001f` (lowercase, escaped) + raw `7f` (DEL) + raw `e2 80 a8` (U+2028) + raw `c3 a9` (U+00E9) + raw `f0 9f 98 80` (U+1F600) + `"}` | `sha256:56ca796abf915839f5114c542afa62a9de53124df711ef47c4df51641b42ec70` |
| cj-006 | `[0,-1,1,9007199254740991,-9007199254740991,120,127,-127]` | same, no spaces | `sha256:49acf9cd778604f49c457c71d156f2e85ad982f30b9b2353f90f0c0d3104ea77` |
| cj-007 | `[0.1, 0.30000000000000004, 1.15, 0.15, 0.000001, 123456.789, 0.5, -2.5, 1.7, 4.35, 0.0003, 0.1+0.7]` | text `[0.1,0.30000000000000004,1.15,0.15,0.000001,123456.789,0.5,-2.5,1.7,4.35,0.0003,0.7999999999999999]` | `sha256:b40cfdcf5bb391ea237f17b3a3e6bfd09fbf0de2acb28fc1988f8d7ffa4b3a61` |
| cj-008 | `[3.0, 1e3, 2**40]` | text `[3,1000,1099511627776]` | `sha256:0e21d11d6b971007875ff6093fd4e835710b9a9ccfcd7d8bc41a9e6ea0796693` |
| cj-009 | `{nfc: U+00E9, nfd: U+0065 U+0301}` (two strings built from those code points) | hex `7b226e6663223a22c3a9222c226e6664223a2265cc81227d`: value `nfc` = U+00E9 = bytes `c3 a9`; value `nfd` = U+0065 U+0301 = bytes `65 cc 81`; the two stay different (no normalization) | `sha256:79eae438d105e852f86ea598ffdda91643386fad0b4f336b941528d30fbf1558` |
| cj-010 | `{pose:[f64(1.5), f64(-0), f64(0.1), f64(-Infinity)]}` | text `{"pose":["f64:3ff8000000000000","f64:8000000000000000","f64:3fb999999999999a","f64:fff0000000000000"]}` | `sha256:c37670da2ffc1fa4642b5927c2e8f17bfbe6bc05cf4150f45f15f3c2e65c457d` |
| cj-011 | 32 nested arrays around `0` (`[[...[0]...]]`) | accepted; text is 32 `[`, `0`, 32 `]` | `sha256:4e04cac422d9ecd4a5f6221653eeb4eaf29077cf3f588cd36bf6dc8ead76971f` |

`F64` helper vectors: `0 -> f64:0000000000000000`, `-0 -> f64:8000000000000000`, `1 -> f64:3ff0000000000000`, `1.5 -> f64:3ff8000000000000`, `0.1 -> f64:3fb999999999999a`, `-0.1 -> f64:bfb999999999999a`, `4.35 -> f64:4011666666666666`, `Infinity -> f64:7ff0000000000000`, `-Infinity -> f64:fff0000000000000`, `NaN -> f64:7ff8000000000000`, `5e-324 -> f64:0000000000000001`, `1.7976931348623157e308 -> f64:7fefffffffffffff`, `2^-1022 -> f64:0010000000000000`.

**Required rejections** (id: input -> code; location as JSON Pointer):

| id | Input | Code |
|---|---|---|
| rj-001 / 002 / 003 | `NaN` / `Infinity` / `-0` | `nan` / `infinity` / `negative-zero` |
| rj-004 | `9007199254740992` | `unsafe-integer` |
| rj-005 | `1e-7` | `float-out-of-range` |
| rj-006 | `1e21` | `unsafe-integer` (integer-valued, beyond 2^53-1) |
| rj-007 / 008 | `{a:undefined}` / `[undefined]` | `undefined` at `/a` / `/0` |
| rj-009 | `{s: 'a' + U+D800 + 'b'}` (lone high surrogate) | `lone-surrogate` at `/s` |
| rj-010 | key U+00E9 | `key-not-allowed` at `/` + U+00E9 (non-ASCII pointer; `pointerHex` in the fixture) |
| rj-011 | own key `__proto__` | `proto-key` at `/__proto__` |
| rj-012 / 013 / 016 / 017 | `Date` / `Map` / `Uint8Array` / class instance | `non-plain-object` |
| rj-014 | `1n` | `unsupported-type:bigint` |
| rj-015 | `[1,,3]` | `sparse-array` at `/1` |
| rj-018 | `{a:[0,-0]}` | `negative-zero` at `/a/1` |
| rj-019 | 33 nested arrays | `too-deep` |
| rj-020 | text `{"a":1,"a":2}` | `duplicate-key` at `/a` |
| rj-021 | text `{ "a": 1 }` | `not-canonical` |
| rj-022 | text `{"b":1,"a":2}` | `not-canonical` |
| rj-023 | text `{"a":1}` + LF | `not-canonical` |
| rj-024 | bytes `7b2261223a225c2f227d` (a JSON-escaped slash) | `not-canonical` |
| rj-025 | bytes `7b2261223a3165327d` (`{"a":1e2}`) | `not-canonical` |
| rj-026 | bytes `7b2261223a225c7530303431227d` (`{"a":"` backslash `u0041"}`, an unnecessary `\u` escape) | `not-canonical` |
| rj-027 / 028 / 029 | bytes `7b2261223a22ff227d` / `efbbbf7b7d` / `{"a":}` | `invalid-utf8` / `bom` / `syntax-error` |
| rj-030 / 031 | input of 16 MiB + 1 byte / a string of 1 MiB + 1 UTF-8 bytes | `too-large` / `string-too-long` |
| rj-032..038 | precedence cases: a syntax error or duplicate key wins over an earlier value-level offender; among value-level offenders the first in document order wins; invalid UTF-8 beats BOM; BOM beats syntax error; text `-0` | `syntax-error`, `negative-zero`, `duplicate-key`, `too-deep`, `invalid-utf8`, `bom`, `negative-zero` |
| rj-039 | float with a trailing zero in text (`1.50`) | `not-canonical` |
| rj-040..043 | JSON Pointer escaping and nesting: key `a/b` -> `/a~1b`, key `a~b` -> `/a~0b`, `{"a.b":[0,-0]}` -> `/a.b/1`, `{"pose":[1,2,1e999]}` -> `/pose/2` | `key-not-allowed` x2, `negative-zero`, `infinity` |
| (no fixture ids yet; unit tests) | `f64Decode('f64:ABCDEF0123456789')` / NaN with non-canonical bits / non-enumerable property / symbol key / getter / array with extra property / non-plain array | `f64-noncanonical` x2 / `hidden-property` / `symbol-key` / `accessor` / `array-extra-props` / `non-plain-array` |

Fixture index: section 8.1 lists every `cj-*`/`rj-*` id; the committed files are on the #163 branch under `tests/fixtures/replay/v1/`.

---

## 3. Two hash tiers

### 3.1 Tier A: identity digests

- Format: `sha256:` + 64 lowercase hex. Algorithm prefix is mandatory; an unknown prefix means **refuse** (never "treat as opaque").
- Input: the canonical bytes (section 2) exactly as stored, so `sha256sum file.bbcj` reproduces it. No extra domain-separation prefix; every hashed document carries its own `format` field *inside* the bytes, which makes cross-type confusion a schema error.
- Where used: `rulesetId`, `manifestDigest`, `causalDigest`, `tapeDigest`, `bundleDigest`, evidence store keys, canary fixture ids.
- Implementation: ship a small **synchronous pure-JS SHA-256** as the reference, optionally accelerated by `crypto.subtle`, with both checked against the vectors at start (the pure-JS one does so at import: `sha256SelfTest()`). Reasons: (a) `crypto.subtle` exists only in secure contexts (an `http://192.168.x.x` dev page has none; UNVERIFIED for deployed origins), (b) Jest's `jsdom` environment does not provide it (jest.setup.js defines no crypto), (c) sync code removes async plumbing. Cost is irrelevant: inputs are tens of KB and hashed outside the sim loop. Tests may cross-check with `node:crypto`.
- Vectors: `sha256("")=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, `sha256("abc")=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` (NIST).

### 3.2 Tier B: frame fingerprints

- Format: `xxh32x2:` + 16 lowercase hex = `hex8(XXH32(bytes, 0x00000000)) + hex8(XXH32(bytes, 0x9E3779B9))`.
- Input: the **BB-FP binary encoding** (section 6.5) of one subsystem's causal state (not JSON text; no allocation of strings in the sim loop).
- Algorithm choice: reuse XXH32 because it is already in the repo, spec-compliant and tested, and has reference implementations in every language (reference vectors: `XXH32("",0)=02cc5d05`, `("a",0)=550d7456`, `("abc",0)=32d153ff`, `("Nobody inspects the spammish repetition",0)=e2293b2f`; and `("abc",0x9e3779b9)=1bab3a57`, `bytes 00..0f -> b72837f4`, `xxh32x2(bytes 00..1f)=830741c1698ff899`). Two seeds give 64 bits. VERIFIED: a bytes-based XXH32 gives identical output to the repo's `xxHash32(string)` on ASCII/UTF-8 inputs, including `seed != 0`; the existing string function stays untouched (ledger hashes depend on it).
- Collision tradeoff: for two *different* states that differ by honest nondeterminism (not an attacker), a matching 64-bit digest is *heuristically* ~2^-64 per comparison (the two seeds are not independent hash functions, so this is an estimate, not a bound): negligible against ~1000 checkpoints x 13 subsystems per run. A 32-bit digest would be ~2^-32 per comparison (~10^-7 over a few thousand), enough in practice but needlessly thin when it costs one extra pass. XXH32 is **not** resistant to adversarial collisions at all (seed is public); that is acceptable only because fingerprints never certify anything.
- A fingerprint MUST NOT be described, logged, displayed or stored as "secure", "signed", "proof", "anti-cheat" or "verified run".
- Existing ledger hashes V1-V4 remain xxHash32 over `JSON.stringify([...])` arrays (not BB-CJSON); they are referenced, never rewritten (section 5.4).

---

## 4. Replay Manifest schema v1 (#116)

### 4.1 Envelope, tiers, definitions

```
{ "format":"bb-replay-manifest", "formatVersion":1, "formatMinor":0, "critical":[],
  "causal":{ ... }, "info":{ ... }, "ext":{ ... } }
```
- **`causal`**: everything that can change the simulated trajectory. `causalDigest = sha256(canonical(causal))`: two runs with the same `causalDigest` and the same `tapeDigest` MUST produce the same fingerprints **under the same verifier**.
- **verifier** (used throughout): one specific build of the simulation (same game bundle, same Phaser/Matter, same ruleset, same JS engine and version) that re-simulates a tape. "Same fingerprints under the same verifier" is *not* a cross-engine claim; cross-engine equality is what #120 measures.
- **reference verifier**: the single pinned build the owner designates for comparisons (Q2). Nothing in v1 declares one "official".
- **evidence** in this contract means a **local integrity record** (manifest + inputs + checkpoints + claims) that lets a verifier re-simulate and compare. It is not authority, proof of play, or proof of entitlement (1.1).
- **`info`**: informational/classification; never needed to replay; included in `manifestDigest` only.
- **`ext`**: extension namespace (key alphabet as 2.1); not part of `causal`.
- `manifestDigest = sha256(canonical(whole manifest))`, stored **outside** the manifest (evidence bundle/index).

### 4.2 Unknown-field and compatibility policy (fail closed)

0. **Order of checks:** `format`, then `formatVersion` (a greater version => `unsupported-format-version`), **then** unknown envelope keys, then the rest; so a future-versioned manifest is reported as an unsupported version, not as unknown fields.
1. Unknown top-level key (outside `format, formatVersion, formatMinor, critical, causal, info, ext`) => **refuse** (`unknown-envelope-field`). Envelope shape changes bump `formatVersion`.
2. Unknown key inside `causal` (any depth) => **refuse** (`unknown-causal-field`): an unknown causal input means this reader cannot reproduce the run.
3. Unknown key inside `info` => **preserve byte-for-byte on re-serialization and ignore**.
4. `ext`: unknown and not listed in `critical` => preserve and ignore. Listed in `critical` (sorted, unique array of `ext` keys) and not understood => **refuse** (`unsupported-critical-extension`). A `critical` entry naming a nonexistent `ext` key => refuse.
5. `formatVersion` greater than the reader's => refuse (`unsupported-format-version`). A greater `formatMinor` is accepted only if rules 1-4 hold: minors may add `info` keys, `ext` keys, and new causal modules that older readers refuse by rule 2. A new causal module therefore reaches old verifiers as a refusal, never as silent ignorance.
6. Missing required field, wrong type, out-of-range value, malformed `F64` => refuse `invalid-field` with a JSON Pointer (`/causal/bsod/syncLevel`); non-canonical bytes keep their BB-CJSON code (section 2).
7. Absence of an *optional* causal module has the meaning given in the table (no `kodiak` module = bears off). Readers MUST NOT apply live-profile defaults.
8. **Cross-field consistency checks MUST run. A failed integer/identity check is a refusal, not a mismatch. The BSOD initial-state check (last bullet) is the one exception: it depends on `Math.log1p`, so a failure is reported as an engine-divergence finding (outcome `inconclusive`, reason `bsod-initial-divergence`, with expected/actual F64), never a refusal, so that cross-engine harnesses (#161) can still measure the run:**
   - `sim.tickHz == input.tickHz == ruleset.versions.tickHz`; `sim.engine == {ruleset.engine.phaser, ruleset.engine.matter}`; `kodiak.version == ruleset.versions.kodiak` (when the module is present); `rng.version == ruleset.versions.runRandom`; `input.protocolVersion == ruleset.versions.inputProtocol.version`.
   - `info.lane.mode == "daily"` implies empty ranks and boosts, no `kodiak` module or `enabled:false`, `magnetsDrop == true`.
   - `rng.physicsScramble == xxHash32("physics/scramble", xxHash32(seed))` (the `Rng.fork` derivation) **only when `rng.version == 1`**; other RNG versions define their own derivation.
   - `dailyRuleSource == "seed-date"` implies `dailyRuleId` equals the rule of the date key in the seed (`DailyPatch.infoForDateKey`); `"clock-at-start"` and `"recorded"` have no external check. **`dailyRuleId == "none"` means "no daily rule" (empty modifiers; this is what `RunScene` L197 assigns when no rule resolves and the header's `|| null` preserves it); it is not an entry of the ruleset's rule table. `null` means "unknown" and is legal only in legacy-derived manifests.** R-1 resolves `none` to empty modifiers and any other id through the ruleset table (absent => refuse).
   - BSOD initial state (**implementable from recorded inputs; the sled left edge is an input because `bounds.min.x` of the compound body is C10 literal geometry**): with `L = bsod.leftEdgeX`, `lvl = max(1, syncLevel)`, `g = log1p(lvl-1)`, `D = ruleset.constants.bsodDefaults`: `wallX = L - D.initialGapPx - 900*g`; `wallSpeedPxS = D.initialSpeedPxS`; `accelerationPxS2 = (D.accelerationPxS2 * upgradeEffects(ranks).bsodAccelerationMul) / (1 + g*0.17)`, all in IEEE double arithmetic in that order, compared **bit-exactly** to `bsod.initial` (this mirrors the `BsodPursuit` constructor, so constructor drift is caught). A verifier SHOULD compute this with its own `BsodPursuit` construction rather than a reimplementation. On mismatch: `inconclusive` / `bsod-initial-divergence` (see the rule header above), not a refusal. Sanity (hard refusal, no transcendental math): `leftEdgeX <= start.pose[0]`.

**Refusal codes and result objects (v1.1; VERIFIED in `manifest.js`).** `validateManifest(input, rulesetResolver | null, opts)` and `validateEvidenceBundle` **never throw for bad input**; they return `{ok:false, code, pointer, detail?}` or
`{ok:true, manifest, manifestDigest, causalDigest, outcome:"valid"|"inconclusive", reasons:[{outcome, reason, pointer, expected, actual}], warnings:[...]}` (`input` = canonical bytes, a canonical string, or a plain object that is canonicalized first; `opts.understoodExtensions` = `ext` keys this reader implements). Refusal `code` is any BB-CJSON code (section 2) or one of: `unsupported-format-version, unknown-envelope-field, unknown-causal-field, unsupported-critical-extension, invalid-field, inconsistent-field` (a failed 4.2.8 cross-field check; the pointer names the offending field), `unsupported-input-protocol, invalid-input-row` (4.4), `unknown-ruleset` (resolver returned nothing), `ruleset-digest-mismatch` (the resolved document does not hash to the id), `invalid-ruleset` (document lacks `versions/engine/constants.bsodDefaults/tables.dailyRules`), `digest-mismatch` (bundle: `manifestDigest` or `inputs` do not hash to what the manifest says), `evidence-ineligible` (builder: Gym lane or lone-surrogate seed), `invalid-run-context` (builder: missing/legacy tape, ruleset, header fields), `unknown-daily-rule` (`resolveReplaySetup`). **Warnings:** `ruleset-checks-skipped` (resolver is `null` while `rulesetId` is non-null: ruleset-dependent checks, including the BSOD formula, did not run; preservation is not execution), `nan-f64:<pointer>` (a NaN F64 in `causal`). **Inconclusive reasons** (never refusals): `bsod-initial-divergence` (4.2.8, last bullet) and `fingerprint-capture-errors` (`info.capture.errorCount > 0`: the recorder failed to capture one or more fingerprints, so checkpoint evidence is incomplete). These validation outcomes are not the verification outcomes of 7.4.

### 4.3 Conventions and field table

**Tick convention (normative).** Ticks are 1-based: `RunScene.update` does `tick = ++simClock.tick` *before* recording the input and calling `simTick` (L1224). **Checkpoint T = state after the T-th `simTick`.** `start.tick = 0` means "before tick 1". `endTick` = the last tick for which `GhostRecorder.afterTick` ran, i.e. the last tick that finished with `crashed == false`. Input rows are recorded **before** `simTick` for every tick including the one in which the crash occurs, so valid row ticks are `1 .. endTick + 1`; **terminal tick = `endTick + 1`** (the crash tick; its state is not checkpointed). Reference: a recorder fed ticks 1-4 with `afterTick` and tick 5 with `input` only has `endTick 4`, and a row at tick 5.

**Claims re-derivation.** `claims.score = Math.max(0, Math.round(snap.total))` (`snap.total` = `ScoreManager.getTotal()`) and `claims.distanceM = Math.floor(scoreManager.distanceM)` exactly as `RunScene.resolveCrash` writes them into the `RunRecord` (L2257-2258; both are integers, so they are legal bare numbers). A verifier re-simulates to the terminal tick, applies the same two formulas to its own ScoreManager, and compares; `claims.endTick` must equal its own last non-crashed tick; a mismatch on any is `diverged` at the terminal tick. `claims.distanceExact` (optional F64) carries the raw `distanceM` double for diagnostics. `cause` is always `"crash"` in v1 tapes (C6); `quit` runs produce no evidence in v1.

Kinds: **C** causal, **K** classification (lane/eligibility), **I** informational. `F64` = section 2.2.

| Path | Type | Req | Kind | Source / notes |
|---|---|---|---|---|
| `format` | `"bb-replay-manifest"` | R | | |
| `formatVersion` | int `1` | R | | |
| `formatMinor` | int >= 0 | R | | `0` for this document |
| `critical` | sorted string[] | R | | may be `[]` |
| `causal.sim.rulesetId` | `sha256:`str \| null | R | C | section 7; `null` only if `info.provenance="legacy-derived"`. When non-null, `simRevision`, `tickHz` and `engine` are **required and non-null** (`resolveVerifier` refuses `malformed-manifest` otherwise) |
| `causal.sim.simRevision` | int >= 1 \| null | R | C | consistency copy; `null` only if legacy |
| `causal.sim.tickHz` | int | R | C | `SIM_TICK_HZ`=120 |
| `causal.sim.engine` | `{phaser,matter}` \| null | R | C | consistency copy (`3.90.0`, `0.20.0`); ruleset authoritative |
| `causal.course.seed` | string, well-formed | R | C | `RunScene.seed`, exact |
| `causal.course.biomeMask` | uint32 | R | C | |
| `causal.course.dailyRuleId` | string \| null | R | C | see 4.2.8 (`"none"`, `null`) |
| `causal.course.dailyRuleSource` | `"seed-date"` \| `"clock-at-start"` \| `"recorded"` | R | C | how it was chosen at recording |
| `causal.loadout.upgradeRanks` | `{id: int>=1}` active only | R | C | `{}` when none |
| `causal.loadout.boosts` | sorted string[] | R | C | `appliedBoosts` |
| `causal.loadout.magnetsDrop` | bool \| null | R | C | `null` only if legacy-derived and unknown (then listed in `info.legacy.absentFields`) |
| `causal.kodiak` | `{enabled,packMode,version}` | O | C | **absent = bears off**. `packMode` in `same|mixed`; `version` = `KODIAK_VERSION` |
| `causal.bsod.syncLevel` | int >= 1 \| null | R | C | `prof.level` at L391/L393 (**C2**); `null` only if legacy |
| `causal.bsod.leftEdgeX` | F64 \| null | R | C | `sledLeftCollisionEdge(sled)` = `body.bounds.min.x` after spawn and boosts; input to the formula in 4.2.8 |
| `causal.bsod.initial` | `{wallX,wallSpeedPxS,accelerationPxS2}` F64 \| null | R | C | derived check values (4.2.8) |
| `causal.start.tick` | int `0` | R | C | non-zero reserved; refuse |
| `causal.start.pose` | F64[6] `[x,y,angle,vx,vy,angVel]` | R | C | sled body after spawn and boosts |
| `causal.rng.version` | int | R | C | `RUN_RANDOM_VERSION` |
| `causal.rng.physicsScramble` | uint32 | R | C | initial state of the only causal stream |
| `causal.input.protocol` | `"bb-pad"` | R | C | 4.4 |
| `causal.input.protocolVersion` | int | R | C | `1` |
| `causal.input.tickHz`, `tiltScale` | int, int `127` | R | C | |
| `causal.input.bits` | `{bool[],edge[],heliShift}` | R | C | self-description (bool fields bit 0-11, edge bit 12-17, `heliShift` 18); MUST equal the protocol version's definition |
| `causal.input.endTick` | int >= 0 | R | C | defined above |
| `causal.input.edgeRows` | `"every-tick"` \| `"legacy"` | R | C | recorder behavior, C11 (written into the tape header as `edgeRows`): `every-tick` = a row is emitted on every tick that has an edge bit set; `legacy` = identical consecutive rows were deduped (edges on later consecutive ticks may be missing) |
| `causal.input.tapeDigest` | `sha256:` | R | C | 4.5 |
| `causal.checkpoints.everyTicks` | int | R | C | 120 |
| `causal.checkpoints.algo` | `"xxh32x2"` \| null | R | C | null only if `detail="none"` |
| `causal.checkpoints.schemas` | `{subsystemName: int}` \| null | R | C | per-subsystem `bb-fp` schema version for all 13 subsystems; `null` iff `detail="none"` |
| `causal.checkpoints.detail` | `none|combined|full` | R | C | how checkpoints are stored |
| `info.gameVersion` | string | O | I | |
| `info.provenance` | `live-recording` \| `legacy-derived` \| `synthetic` | R | I | selects guarantees (5). `live-recording` requires `edgeRows="every-tick"` |
| `info.lane` | `{mode, dailyOfficial, dailyMode, draft?}` | O | K | `mode` in `normal|daily|daily-draft` (`gym` never evidence-eligible) |
| `info.inputCapture.edgeAssignment` | string | O | I | recorder-side policy (`frame-first-tick` today; `timestamp-window` under #115) |
| `info.capture` | `{errorCount:int>=0}` | O | I | number of failed fingerprint captures during the run (`GhostRecorder.fingerprintErrorCount`); non-zero => fingerprints are dropped (`detail:"none"`) and the outcome is `inconclusive` / `fingerprint-capture-errors` |
| `info.rngVisual` | `{visualSled,visualFx,visualCamera}` uint32 | O | I | |
| `info.legacy` | object | O | I | section 5 |
| `ext` | object | R | | `{}` allowed |

Timers: gameplay timers start from fixed values derived by code from the loadout and ruleset table, so v1 stores no timer values; they are covered from tick 120 on by the fingerprints and by the derivation checks. UNVERIFIED that none is initialized from a clock; the reflection test (6.8) is the guard.

Not in the manifest: `startedAt`/`endedAt`/`runId`/`controlLayout`/UA/initials (privacy, 1.3); score/distance/cause (claims); the pose trace (regenerable); derived static tables (ruleset).

### 4.4 Input protocol `bb-pad` v1 (fully specified)

A tape is a list of rows `[dt, bits, tilt127]`, all integers. Meaning (this is what `TapePlayer`/`decodePad` do at `b51ab36`, plus explicit refusals):

1. `dt >= 1`. The **first row's `dt` is the absolute tick** (measured from 0, ticks are 1-based); each later row's tick is the previous row's tick plus its `dt`. Row ticks are strictly increasing and `<= endTick + 1`.
2. Before the first row the pad is `decodePad(0, 0)`: every boolean false, `tilt = 0`, `heli = 0`, `brake = false`.
3. A row's pad is **held** from its tick until the tick before the next row.
4. **Edge bits apply only on the row's exact tick**; on later ticks the same pad is used with all `pressed` flags false.
5. `bits` is an unsigned 32-bit integer; **bits 0-19 are defined; bits 20-31 MUST be 0** (mask `0xFFFFF`; a row with higher bits => refuse `invalid-input-row`). Bit 0-11 (bool, in order): `push, variableHop, noAutoNudge, divebomb, corkscrew, tuck, brakeHeld, hop, reset, airBrake, parachute, pause`. Bits 12-17 (edge, in order, mapped to `pressed.*`): `hop, reset, pause, airBrake, parachute, confirm`. Bits 18-19: `heli` (0 none, 1 = +1, 2 = -1). **Value 3 is refused** (`invalid-input-row`); the current decoder maps it to none, which would hide a corrupt row.
6. `tilt127` is an integer in `[-127, 127]` (else refuse); `tilt = tilt127 / 127`. `-0` is normalized to `0` at record time and in the digest projection (C4).
7. `brake` is **derived each tick** (`brakeHeld || (airBrake && sled.grounded)`), never stored. `lastSource` is not part of the protocol.
8. **Edge rows (C11).** Identical consecutive rows are not required to be stored *unless an edge bit is set*: v1 recorders MUST emit a row on every tick whose `bits` has any edge bit set. `GhostRecorder.input` at `b51ab36` dedupes identical consecutive rows, so edges on ticks 2-3 after an edge on tick 1 (with unchanged held bits) are lost (VERIFIED by executing it: ticks 1-3 with `hop` edge produce one row; replay sees the edge only on tick 1). **Fixed in #164** (VERIFIED): `GhostRecorder.input` skips an identical consecutive row only when no edge bit (mask bits 12-17) is set, and the recorder writes `edgeRows:"every-tick"` into the tape header. The fix changes only which rows are *written*; `TapePlayer` and the row format are unchanged, so every reader keeps working. A tape **without** the `edgeRows` header field was recorded by the older deduping recorder: `legacyManifestFromTape` declares it `edgeRows:"legacy"` and it carries the documented limitation (legacy-derived outcomes can be `inconclusive-legacy`); `buildManifest` refuses (`invalid-run-context`) to describe such a tape as a live recording.

**Versioning (for #115 and future formats).**
- The tape's meaning is defined by `(causal.input.protocol, protocolVersion)`, not by `GHOST_TAPE_VERSION` alone. `bb-pad` v1 maps to `GHOST_TAPE_VERSION` 1.
- **Pad bits are append-only.** A new input field takes the next free bit and bumps `protocolVersion`; a v1 reader refuses rows with undefined bits rather than ignoring them.
- **A v1 tape stays verifiable forever:** each protocol version's decoder is retained as part of the verifier artifact for the matching `simRevision`; a verifier selects the decoder by `(protocol, protocolVersion)` and refuses (`unsupported-input-protocol`) if it lacks one.
- #115 (timestamp -> tick window) changes **how a recorder assigns key events to ticks** (`SimClock.padsFor`), not what a row means; its tapes remain `bb-pad` v1. `info.inputCapture.edgeAssignment` lets analyses separate tapes by capture policy without affecting replay. Only if #115 needs a new recorded quantity does `bb-pad` become v2 (announced in #152; v1 decoder kept).
- A replay does not use `SimClock`; `accMs/droppedMs/_edges` are scheduling state and not causal. Only `SimClock.tick` is.

### 4.5 Tape content digest and the evidence bundle

`tapeDigest = sha256(canonical({"format":"bb-input-tape","formatVersion":1,"protocol":{"id":"bb-pad","version":1},"tickHz":120,"endTick":N,"inputs":[[dt,bits,tilt127],...]}))`. Row integers are normalized `v === 0 ? 0 : v`. Cosmetic `trace`, `startedAt`, checkpoints are **not** in this digest. (Scratch tape example: inputs `[[1,7,0],[199,6,0],[50,4230,0],[1,134,0],[19,6,0],[31,6,127],[39,6,0]]`, `endTick 600` -> `sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23`; unchanged by this revision because the projection did not change.)

Evidence bundle `bb-replay-evidence` v1 (one canonical file):

```
{ "format":"bb-replay-evidence","formatVersion":1,
  "manifest":{...}, "manifestDigest":"sha256:...",
  "inputs":[[dt,bits,tilt127],...],              // must hash to manifest.causal.input.tapeDigest
  "checkpoints":[[120,"<16hex>"], ...],          // detail=combined; detail=full: [tick, combined16, s1_16 .. s13_16] in FP_SUBSYSTEMS order
  "exact":{"sled":[[120,"f64:..x","f64:..y","f64:..angle","f64:..vx","f64:..vy","f64:..w",score_int],...]},  // optional
  "claims":{"endTick":N,"cause":"crash","score":S,"distanceM":D,"distanceExact":"f64:.."} }
```
- Every simulation double is an `F64` string (2.2(a)): `exact.sled` (six doubles per row; the seventh value, `score`, is the rounded integer total) and `distanceExact`. A bare decimal there would throw for `|x| < 1e-6` or `-0`.
- Checkpoint digests inside `checkpoints` rows are **bare 16-hex strings without the `xxh32x2:` prefix**: the algorithm is fixed for the whole file by `manifest.causal.checkpoints.algo`, and the rows are the bulk of the file (up to 14 values per row). Standalone digest values (in a `CompareResult`, a log, or any context without that manifest) always carry the prefix. Readers MUST reject a row whose strings are not exactly 16 lowercase hex digits.
- `bundleDigest = sha256(canonical(bundle))` is the store key. Claims are assertions to be re-derived (4.3), not facts. v1 has no terminal fingerprint (6.6).

---

## 5. Legacy compatibility

### 5.1 Principle

Existing `bb-ghost-tape` v1 tapes are **not migrated or rewritten**. A "legacy-derived manifest" is *computed on demand* from the tape header, marked `info.provenance:"legacy-derived"`, and carries **reduced guarantees**. Nothing is written back to IndexedDB, the ledger, or `SaveStore`; v1 requires no data migration.

### 5.2 Mapping

| Tape header (`_ghostHeader`+recorder) | Legacy-derived manifest | Note |
|---|---|---|
| `seed`, `biomeMask` | `causal.course.*` | exact |
| `dailyRuleId` | `causal.course.dailyRuleId`, source `"recorded"`; absent/empty => `null` | recorded since #56, **ignored by replay before #164 (C1)** |
| `boosts`, `upgradeRanks` (null -> `{}`), `magnetsDrop` | `causal.loadout.*` | `magnetsDrop` absent => `null` in the manifest, listed in `info.legacy.absentFields`; replay uses the default of 5.3 (C3) |
| `kodiaksOn`/`kodiakPackMode`/`kodiakVersion` | `causal.kodiak` | all three present => `{enabled,packMode,version}`; **all three absent => the `kodiak` module is omitted** (absence = bears off, 4.2.7; the tape predates Kodiaks); partially present => refuse |
| `startPose` | `causal.start.pose` (F64) | exact |
| `random.physicsScramble`, `runRandomVersion` | `causal.rng` | exact; `visual*` -> `info.rngVisual` |
| `simTickHz`, `version`, `endTick`, `inputs` | `causal.input.*` | `protocolVersion` = tape `version` |
| `physicsVersion` | `info.legacy.physicsVersion` | not a ruleset |
| *(none)* | `causal.sim.rulesetId = null`, `simRevision = null`, `engine = null` | not recorded |
| *(none)* | `causal.bsod.syncLevel = null`, `leftEdgeX = null`, `initial = null` | **not recorded (C2)** |
| *(none)* | `causal.input.edgeRows = "legacy"` | recorder dedupe (C11) |
| checkpoints (exact sled, 7 numbers/120 ticks) | `causal.checkpoints.detail="none"`, `algo=null`, `schemas=null`; numbers converted to `F64` strings in bundle `exact.sled` | |
| `startedAt`, `endedAt`, `runId`, `controlLayout`, `trace` | dropped from the manifest | privacy / regenerable |
| `format`, `version`, `physicsVersion`, count of checkpoints | `info.legacy` | |

### 5.3 Replay defaults, reduced guarantees and outcomes

**Replay defaults (VERIFIED, `resolveReplaySetup`).** A replay never reads the live profile. Values an older tape never recorded get a deterministic default decided from git history, and **each defaulted name is returned in `defaulted: [...]`** so strict verification and canaries can report reduced guarantees:

| Absent in the tape/manifest | Replay uses | `defaulted` name | Why |
|---|---|---|---|
| `magnetsDrop` | **`true` (ON)** | `magnetsDrop` | ghost tapes (`da8935a`) predate the Sync Level 5 magnet gate and the header field (`3b6b961`); until then magnets always dropped |
| all Kodiak fields (tape) / `kodiak` module (legacy manifest) | bears **off** | `kodiak` | Kodiaks (`44e291c`) postdate every such tape |
| `syncLevel` | **1** | `syncLevel` | never recorded before #164; the true level is unknowable |
| `dailyRuleId` null/absent | no rule (`"none"`) | `dailyRule` | older tapes without the field |

A *live-recording* manifest has none of these absent, so its `defaulted` is empty; for a legacy-derived manifest `syncLevel` is always listed. Strict verification of a run whose `defaulted` is non-empty reports **reduced guarantees** (it can still be `consistent-with`, never `match`).

A legacy-derived manifest can only be checked by a verifier that **declares its own ruleset** (`verifiedUnder: <rulesetId>`). Outcomes:
- all exact sled checkpoints match (numeric `==`, so `+0 == -0`) and `endTick` matches: `consistent-with` (never `verified`);
- a checkpoint mismatch: `inconclusive-legacy` (the tape may simply predate a behavior change, C1/C2/C3, C11 `edgeRows:"legacy"`, and unrecorded Sync Level); never `refuted`;
- legacy outcomes MUST NOT be eligible for any scoreboard keyed by `rulesetId` (section 7.5).
Tapes whose run never involved BSOD aerodynamics or the wall catch will usually be indifferent to the unknown Sync Level; that is an observation, not a guarantee. Example (implementation output): the section 8.3 legacy tape, which has every other field, reports `defaulted: ["syncLevel"]`.

### 5.4 Run ledger V1-V4

- `RunRecord`s and `computeLedgerHashV1..V4` are **not touched**, not rehashed, not extended. `sanitizeRun` keeps dropping unknown keys and never recomputes `ledgerHash`.
- The link record -> evidence is by local index (`runId` -> `bundleDigest`) in the evidence database, not a record field (a new record field would need a V5 hash; that decision is deferred, Q7).
- A manifest never embeds a ledger hash and the ledger never embeds a bundle digest in v1.

---

## 6. Authoritative causal state and fingerprints (#118)

### 6.1 Definitions

*Causal state* at tick T is everything that, together with inputs for ticks > T and the ruleset, determines the future. The contract does **not** require it to be *restorable* (savestate is #119); it requires it to be **complete enough that a divergence in any causal variable changes some subsystem fingerprint no later than the next checkpoint**. Presentation state (camera, Fx, HUD, audio, particles, `visual*` RNG, Glitch director) is excluded and tested for non-influence (6.9, #140).

**Tick convention:** checkpoint T is the state after the T-th `simTick`; `start.tick = 0` is before tick 1 (4.3). `captureCausalState(...).tick` obeys it.

### 6.2 What is reachable in Phaser 3.90's bundled Matter 0.20.0 (honest ledger)

VERIFIED by reading `node_modules/phaser/src/physics/matter-js/lib`:
- `World.step(delta)` = `Engine.update(engine, delta)` only; the game drives it manually (`autoUpdate:false`, <= 8 ms substeps, so each 120 Hz tick = 2 substeps of ~4.1667 ms).
- Hidden per-body state beyond position/velocity: `positionPrev`, `anglePrev`, `deltaTime`, `force`, `torque`, `positionImpulse`, `constraintImpulse`, `totalContacts`, `isSleeping`, `motion`/`sleepCounter` (sleeping is off by default, UNVERIFIED for this Phaser config). Velocity in 0.20 is derived from `position - positionPrev` normalized by `deltaTime`, and `setVelocity` writes `positionPrev`; so *(position, velocity)* does **not** round-trip exactly to the stored state. The existing 7-number sled checkpoint is therefore **detection-only, not a savepoint**.
- The sled is a compound body (5 parts: 2 skids, deck, torso, head). Part `position`/`angle`/`positionPrev` are updated incrementally and are separate hidden state.
- Collision persistence: `engine.pairs.list` keeps contact `normalImpulse`/`tangentImpulse` between steps (warm starting), `pair.isActive`, `separation`. Order is the detector's order.
- Broadphase ordering: `Detector.collisions` sorts `detector.bodies` by `bounds.min.x` (`_compareBoundsX`); ties keep prior array order (stable sort), which depends on insertion/removal history of terrain colliders. `Collision.collides` picks `bodyA/bodyB` by `body.id` ordering. **Absolute ids are not causal; relative id order and detector array order are.** Ids come from module-global `Common._nextId` (never reset between runs in a session) and `Pair.id` strings embed them: this is the "fifth run in one session" question for #120. UNVERIFIED that no behavior depends on absolute id values.
- `engine.timing.timestamp` accumulates substep deltas (deterministic, informational); **`timing.lastElapsed` is wall clock (C9) and MUST be excluded**; so must `metrics`, `lastUpdatesPerFrame`.
- `TerrainContact.installTerrainContactFix` monkey-patches `Matter.Collision.collides` globally once (idempotent flag); this is part of "engine identity" (ruleset records `terrainSnapNormals`, `terrainSnapMaxDepthPx`), not state.
- Also JS global math: ~84 `Math.sin/cos/atan2/pow/sqrt/hypot/tanh/log1p` call sites in sim code. Engines may differ in last-ulp results (UNVERIFIED which). The contract's answer is to make such a difference *visible* (bit-exact digests), not to claim parity (#120/#121).
- Terrain generation is a pure function of `(seed, chunk index, content defs, biomeMask)` (docs and code: `crng = new Rng(hashInts(seedState, index+1))`; `bounds[]` is a deterministic chain). The generator's live cache/pool is call-history dependent but has no causal effect, **provided** chunk joining stays gated by sled position (VERIFIED: `streamTerrain` gate, `RunScene.streamTerrain`, L808-831). So the terrain "state" the contract hashes is *which chunks are physically joined*, not generator internals.

### 6.3 Subsystem catalog (FINAL at the schema versions below)

13 subsystems, fixed order `FP_SUBSYSTEMS = [clock, rng, sled, matter, terrain, hazards, pickups, effects, bsod, kodiak, score, tricks, recovery]`.

**Status: FINAL (frozen).** The field lists below are copied from `src/systems/replay/fingerprintSchemas.js` (#165, `f3fc93d`; the same file is unchanged in #164 `4eaa371`) and are frozen at these per-subsystem schema versions: `clock 1, rng 1, sled 2, matter 2, terrain 1, hazards 1, pickups 1, effects 1, bsod 1, kodiak 1, score 1, tricks 1, recovery 1`. Adding, removing, reordering or retyping a field in a subsystem bumps **that subsystem's** version; old fixtures stay valid under the old version (section 9). The numbers `sled 2` and `matter 2` are not a break: the provisional v1.0 table was iterated by #165 before any fixture reached `main` (v2 of `sled` removed `flags.shield`; v2 of `matter` added `staticOrder.padLast`). A regression-lock fixture, `tests/fixtures/replay/v1/fingerprint-schemas-v1.json` (produced by the #165 implementation itself, so it pins drift but does not independently prove the layout), pins the field lists and the digests of a fully populated synthetic reference state.

**Reading the table.** Types and encoding are those of 6.5 (`str, bool, u32, i32, f64, opt<T>, list<T>`, records are the fields in order). `a,b,c:f64` means three consecutive f64 fields. **BODYF** = `x,y,px,py,angle,anglePrev,vx,vy,angVel,fx,fy,torque,posImpX,posImpY,conImpX,conImpY,conImpAngle,deltaTime:f64; totalContacts:i32; isSleeping:bool` (a Matter body: position, previous position, angle, previous angle, velocity, angular velocity, force, torque, position impulse, constraint impulse, `deltaTime`, contact count, sleeping). Sorted lists use UTF-16 code unit order for strings and ascending numeric order for numbers; maps are lists of `{k,v}` sorted by key; every other list keeps array order, which is part of the state.

| Subsystem | Schema version | Fields (in order) |
|---|---|---|
| `clock` | 1 | {tick:u32; runTimeMs:f64; crashed:bool} |
| `rng` | 1 | {version,physicsScramble:u32} |
| `sled` | 2 | {body:{BODYF}; parts:list<{x,y,px,py,angle,anglePrev:f64}>; ctl:{msSinceContact,groundAngleDeg,airtimeMs,hopBufferMs,playerHopElapsedMs,pushCooldownMs,parachuteMs,parachuteFuelMs:f64; canopyFuelFullMs:opt<f64>; heliPhase,heliVel,invulnerableMs,boostMs,geyserCooldownMs,airEtaMs:f64; airSlopeDeg:opt<f64>; dropAheadDeg,groundRunMs,sinceLaunchMs,landSettleMs,crawlMs,lastTilt:f64; preVx:opt<f64>; preVy:opt<f64>; touchdownVx:opt<f64>; touchdownVy:opt<f64>; heliInput:i32}; flags:{contactFlag,playerHopActive,chuteUsed,tucked,airBrakeActive,corkscrewActive,scrambled,nudging,inWorld,destroyed:bool}; lastPad:opt<{bits:u32; tilt127:i32}>} |
| `matter` | 2 | {timestamp,lastDelta:f64; gravity:{x,y,scale:f64}; bodies:list<{label:str; sensor:bool; BODYF; parts:list<{x,y,px,py,angle,anglePrev:f64}>}>; staticOrder:list<{label:str; minX,minY:f64; padLast:opt<f64>}>; pairs:list<{aLabel,bLabel:str; aMinX,bMinX:f64; active:bool; separation:f64; contactCount:i32; contacts:list<{normalImpulse,tangentImpulse:f64}>}>} |
| `terrain` | 1 | {seedState,biomeMask:u32; joined:list<i32>; queue:list<i32>; chunkDigests:list<str>} |
| `hazards` | 1 | {chunks:list<{chunk:i32; items:list<{defId:str; hit,destroyed,open,rolling,nearMissed:bool; side:opt<i32>; phase:f64; roll:{activeAtMs:opt<f64>; offsetPx,vPxS,simMs,simDist,simV:f64}}>}>} |
| `pickups` | 1 | {collectedPowerups:list<str>; shardCollected:list<str>; activeZones:list<str>; liveShards:list<{chunk:i32; shards:list<{id:str; x,y:f64}>}>} |
| `effects` | 1 | {slowMs,slowFactor,scrambleMs,boostMs,boostFactor,slowmoMs,slowmoScale,hitStopMs,blinkMs,resetCooldownMs,glideMs,glideMul,stabilizeMs,stabilizeDeg,stabilizeBounce,magnetMs:f64; shieldCharges,openingGraces:i32; shieldSources:list<str>; wards:list<{id:str; msLeft:f64; mods:list<str>; hazards:list<str>; effects:list<str>; speedFactor:f64}>; magnetEff:opt<{pullRadiusPx,pullPxS:f64}>} |
| `bsod` | 1 | {active:bool; wallX,wallSpeedPxS,accelerationPxS2:f64; caught:bool; bluff:{armed,usedCanopy,usedAirbrake:bool; closestGapPx:opt<f64>; previousGapPx:opt<f64>; chain:u32; lastAwardX,lastAwardTimeMs:f64}} |
| `kodiak` | 1 | {next:u32; on:bool; bears:list<{kind:str; n,member:u32; x,speed:f64; phase:str; phaseMs,ageMs:f64; rngState,feints:u32; targetX:opt<f64>; groundY:f64; sledAhead:bool; real:opt<bool>; hit,done:bool}>} |
| `score` | 1 | {mgr:{distanceM,trickPoints,penaltyPoints,bonusPoints,bestCombo,flow,flowRemainingMs,bestFlow,pending:f64; lastMilestoneSector:i32; bonusCounts:{shard,nearMiss,milestone:f64}; bonusByKind:{shard,nearMiss,milestone:f64}; comboTricks:list<str>; paid:list<{k:str; v:f64}>; counts:list<{k:str; v:f64}>}; run:{shardChain,shardChainAt,shardTotal,shardCount,nearMissCount,maxAirtimeMs,bestCombo,lastTotal:f64; trickCounts:list<{k:str; v:f64}>}} |
| `tricks` | 1 | {tracker:{air:bool; airStart,tiltNet,heliNet,tiltDone,heliDone,corkscrewNet,corkscrewDone,brakeMs,chuteMs,heliMax,prevAngle:f64; brakeDone,chuteDone,heliHeld,havePrev:bool; prevHeli:opt<f64>}; airTricks,landings,steepMs:f64} |
| `recovery` | 1 | {pendingCrash:opt<{cause:str; hazardId:opt<str>}>; crashTimerMs:f64; safeSamples:list<{t,x,y,vx,vy,ang:f64}>; safeTimer:f64} |

**Capture rules (VERIFIED in `fingerprintCapture.js`; a deviation changes digests):**
- `sled.parts` = the compound body's parts **excluding the root** (filtered by id); the root is `body`. `canopyFuelFullMs`, `preVx`, `preVy`, `airSlopeDeg`, `touchdownVx/Vy` are `opt<f64>` (null when undefined/null); `geyserCooldownMs` and `crawlMs` are `x ?? 0` (the simulation reads `(x || 0)`). `flags.inWorld/destroyed` are causal (lifecycle of the body); `flags.shield` was removed in v2 (render-time mirror of `effects.shieldCharges`, cadence dependent). `lastPad` = `{bits, tilt127}` of `_lastPad` (the `bb-pad` identity, `-0` normalized) or null; the sim only uses `pad !== _lastPad` (object identity), so this is a diagnostic mirror.
- `matter`: `bodies` = every **non-static, non-sled** body in detector order (the sled root is excluded by Matter id, not object identity), each BODYF plus its parts (root excluded); in this game it is normally empty. `staticOrder` = **every static** body (terrain colliders, hazard and pickup sensors, bounce pads) in detector order with `label`, `bounds.min.x/y`, and `padLast` = the bounce-pad cooldown stamp `body.bbPad._last` (run ms of the last launch; null when not a pad or never fired). `pairs` = `engine.pairs.list` in order; `contactCount` and **both** warm-start `contacts` slots (stale slots seed a later contact). `lastDelta` and `timestamp` are `engine.timing`; `gravity` is `engine.gravity`. **Never** `timing.lastElapsed` (wall clock), `metrics`, `lastUpdatesPerFrame`, absolute ids.
- `terrain.chunkDigests[i]` = the **GV1 digest** of the generated chunk object `terrain.active.get(joined[i])`, memoized per index (chunks are immutable after generation). **GV1 (generic value, v1) encoding**, then `xxh32x2:` of the bytes: one tag byte then payload: `0` null; `1` false; `2` true; `3` f64 (tag + 8 bytes LE bits, any NaN canonical); `4` string (tag + `u32` UTF-8 length + bytes); `5` list (tag + `u32` count + elements; typed-array views encode as lists of f64; an `undefined` element throws); `6` record (tag + `u32` count + for each own enumerable key in UTF-16 order, skipping keys whose value is `undefined`: key as `str` payload then the value). Maximum depth 24 (deeper or cyclic throws). It covers **every own enumerable property of the chunk object**, so a new property on generated chunks changes every `terrain` digest without a schema bump: treat that as a causal change (`SIM_REVISION` bump, fixture refresh). A joined index already recycled by the generator pool digests as the string `absent` (deterministic, not memoized). `captureCausalState(scene, {chunkMemo:false})` re-hashes every chunk (tests).
- `hazards`: per joined chunk ascending; `nearMissed` (`h.nearMissed`) and `side` (`opt<i32>` from `h._side`) are the near-miss bookkeeping; mover body poses live in `matter.staticOrder` (moving sensors change bounds). `pickups.liveShards`: per chunk ascending, shards in array order with their *current* `x,y` (a Shard Magnet pulls them, so positions are state). `pickups.activeZones` keys are `${modId}:${round(x0)}`.
- `effects.magnetEff` = `{pullRadiusPx, pullPxS}` with defaults resolved (96 and 360 when not finite): the only fields `ShardMagnet.magnetStrength` reads. `wards` shape is the `Wards.js` ward (`id, msLeft, mods, hazards, effects, speedFactor`), array order = application order. `shieldSources` array order = spend order (most recent first).
- `score.mgr.bonusCounts` and `bonusByKind` are three-key records `{shard, nearMiss, milestone}` of **f64** (capture throws if a key appears or disappears); `run.*` are RunScene counters; `tricks.airTricks/landings/steepMs` are RunScene `_airTricks/_landings/_steepMs`.
- `recovery.pendingCrash` is `{cause, hazardId}` only (capture throws on any other key); `safeSamples` drive `manualReset`/respawn.
- Presentation fields are listed with a reason, per owner class, in `NON_CAUSAL` (for example `blindMs/blindVis`: overlay only; `Hazard.warned/alert/spin`: draw and telegraph; `Sled.pose/squash/_time/snapSteps`; `GlitchDirector` entirely; `RunScene` camera/HUD/audio/hint fields, 104 entries). `Hazard.warned` is marked "#155 may reclassify".

### 6.4 Why per-subsystem digests

A matching sled pose proves nothing about the rest of the world. Each subsystem has its own digest, and `combined` is the digest of the 13 digests. Requirement (acceptance for #118): **a BSOD-only mutation changes `bsod` and `combined` while `sled` (and every other subsystem) is bit-identical.** Reference vector (6.10) demonstrates it: `bsod.wallX` increased by exactly 1 ulp (`f64:c0bd2fecccccccce` -> `f64:c0bd2feccccccccf`) leaves the sled digest `xxh32x2:4eab99674ff7efe1` unchanged and changes the BSOD digest from `xxh32x2:eca47c91b23b1ae3` to `xxh32x2:4569b94722e48212`.

### 6.5 BB-FP v1 binary encoding (the bytes that get hashed)

Little-endian. Per subsystem: `u32 schemaVersion` then the fields in the table order, schema-driven (names are not encoded; the field list is the schema).

| Type | Bytes |
|---|---|
| `u32` | 4, LE; range-checked |
| `i32` | 4, LE two's complement; range-checked |
| `f64` | 8, LE IEEE-754 bits **as is** (preserves `-0`, `±Infinity`); any NaN -> canonical `0x7ff8000000000000` |
| `bool` | 1 byte, 0/1 |
| `str` | `u32` UTF-8 byte length + bytes |
| `opt<T>` | 1 byte presence (0/1), then `T` if present |
| `list<T>` | `u32` count, then elements |
| record | fields concatenated, no padding, no tags |

`combined` input: `u32 fpVersion(=1) | u32 tick | u32 count | count x 8 bytes`, where each 8-byte group is the **hex-decoded** 16-hex digest of that subsystem (big-endian hex order, no prefix); the API `combineFingerprints(tick, digests, order)` takes the **prefixed** digests (`xxh32x2:<16 hex>`) keyed by subsystem name plus the canonical order, and throws on a missing, extra or duplicate name or a malformed digest in `FP_SUBSYSTEMS` order; digest = `xxh32x2`. All digests present or `throw` (a missing subsystem is a bug, never a silent zero).

### 6.6 Interface and cadence

```
// src/systems/replay/fingerprint*.js  (pure; no Phaser import)
FP_VERSION = 1;  FP_SUBSYSTEMS = Object.freeze([...13 names...]);  FP_SCHEMAS = { name: { version, schema } }
captureCausalState(sceneLike, opts?) -> CausalState = { fp: 1, tick: int, <subsystem>: plain object, ... }   // reads, never mutates; opts.chunkMemo:false re-hashes every chunk
fingerprintState(state)        -> { fp: 1, tick, combined: "xxh32x2:...", subsystems: { clock: "xxh32x2:...", ... } }   // TypeError unless state.fp === 1; throws on a missing subsystem or schema mismatch (with a path)
dumpState(state, opts?)        -> flat { tick, "clock.tick": 120, "bsod.wallX": "f64:...", "kodiak.bears.length": 1, "kodiak.bears[0].phase": "approach", ... }
compareRuns(a, b, opts?)       -> Promise<CompareResult>        // ASYNC (v1.1); opts.ignoreCausal, opts.everyTicks (default 120)
```
`sceneLike` is a duck type (what `GhostRecorder.afterTick(tick, scene)` already receives), so capture is testable without Phaser. `captureCausalState` allocates; it runs only at checkpoint ticks or in explicit diagnostic windows, never per tick in production. **`dumpState` key order is canonical**: `tick` first, then subsystems in `FP_SUBSYSTEMS` order, within each the schema's field order, lists by ascending index; a list contributes a `<path>.length` entry before its elements; floats are `F64` strings; an absent optional is `null`; `opts.subsystems` restricts the dump. "First differing field" means first in this order. Encoding errors are `TypeError`s of the form `fingerprint <subsystem>.<field>: <message>`; a missing field, an extra field, `undefined` in an optional, or an out-of-range integer throws, never defaults silently.

**Cadence.** Production: after `simTick` on every tick with `tick % 120 === 0` while not crashed, i.e. exactly where `GhostRecorder.afterTick` records the sled checkpoint. **No new RunScene `update()` lines**: the hook is `GhostRecorder.afterTick` (`_fingerprint`), which stores `{tick, combined, subsystems}` in `recorder.fingerprints` (beside the tape, never inside it). **Capture failures never break a run**: they are counted in `recorder.fingerprintErrorCount` (uncapped), the first few kept in `fingerprintErrors`, and the first is `console.warn`ed; the evidence path treats a non-zero count as incomplete fingerprints (4.2 `fingerprint-capture-errors`). **Terminal capture at the crash tick: still none** (the crash tick is not passed to `afterTick`: `if (!this.crashed)` guards it); v1 has only `claims.endTick/cause/score/distanceM`, and a harness that wants the terminal state captures it itself. Diagnostic: per-tick capture inside an explicit window (tools only, off in production).

**`compareRuns(a, b)`** (`a` = reference/expected, `b` = under test). Each side is a `RunTrace = { causalDigest?, manifestDigest?, endTick?, checkpoints: [{tick, combined, subsystems?}], resimulate?({fromTick, toTick}) -> FingerprintResult[], dumpAt?(tick) -> CausalState }`; `resimulate` re-runs that side from tick 0 and returns the per-tick fingerprint (with `subsystems`) of every tick in `(fromTick, toTick]`; the caller owns the simulator, this module imports none. Steps:
1. Without `opts.ignoreCausal`: a missing `causalDigest` on either side => `inconclusive` / note `no-causal-digest`; differing digests => `inconclusive` / `causal-mismatch`.
2. Both checkpoint lists empty => `inconclusive` / `no-checkpoints`. A list that is not exactly ticks `120, 240, ...` (gap, reorder, a failed capture) => `inconclusive` / `checkpoint-gap`; never read as agreement or divergence.
3. First checkpoint whose `combined` differs, else: different tick => `diverged` / `checkpoint-tick-mismatch`; different list lengths => `diverged` / `checkpoint-count-mismatch`; both `endTick` present and different => `diverged` / `end-tick-mismatch`; otherwise `match` (note `end-tick-not-compared` when an `endTick` is missing). **A run is not a `match` unless causal digests, checkpoints and, when present, end ticks all agree.**
4. If a side has no `resimulate`: `inconclusive` / `no-resimulate`, with `differingSubsystems` from stored `full` detail when both sides carry it.
5. One re-simulation per side over `(t0, t1]` (`t0` = previous matching checkpoint, `t1` = divergent checkpoint; this equals bisection but needs two re-sims rather than `log2(120)` per side because capture does not perturb timing; without savestates every probe restarts from tick 0). A malformed window => `inconclusive` / `bad-resimulation-window`; no per-tick difference => `inconclusive` / `divergence-not-reproduced`. **The re-simulated digests are checked against the stored ones**: if the last re-simulated tick does not reproduce the recorded checkpoint on either side => `inconclusive` / `resim-does-not-reproduce-checkpoint`, because its first divergence would mean nothing.
6. `firstDivergentTick` = first per-tick `combined` mismatch; `differingSubsystems` from the two per-tick results. Without `dumpAt` on both: `diverged` / `no-dumpAt` with `subsystem` = first differing subsystem. Else `dumpAt(tick)` on both, flat-dump and diff (`Object.is`): `fieldPath` = first differing path, `subsystem` its owner, `differingPaths` = all differing paths of that subsystem in canonical order; identical dumps with different digests => `diverged` / `dumps-identical-but-digests-differ`.

```
CompareResult = { status: "match" | "diverged" | "inconclusive",
  firstDivergentTick, firstDivergentCheckpoint, subsystem, fieldPath, expected, actual,
  differingSubsystems:[...], matchingSubsystems:[...], resims:int, differingPaths:[...], note? }
```
`differingPaths` is additive (v1.1). Example (the BSOD-only mutation): `{"status":"diverged","firstDivergentTick":97,"firstDivergentCheckpoint":120,"subsystem":"bsod","fieldPath":"bsod.wallX","expected":"f64:c0bd2fecccccccce","actual":"f64:c0bd2feccccccccf","differingSubsystems":["bsod"],"matchingSubsystems":["clock","rng","sled","matter","terrain","hazards","pickups","effects","kodiak","score","tricks","recovery"],"resims":2,"differingPaths":["bsod.wallX"]}` (tick `97` illustrative).

### 6.7 Checkpoint storage detail

`combined` (default in the archive): `[tick, combined]` per checkpoint, detects drift but cannot attribute it without a second source. `full`: `[tick, combined, s1..s13]`; attributes the subsystem without re-simulation on the recording machine. Canaries and conformance reports SHOULD use `full`. A verifier that has the tape can always regenerate per-subsystem digests on its own side; it needs the other side's `full` only to attribute without access to the original machine.

### 6.8 Completeness enforcement (anti-drift)

`fingerprintSchemas.js` carries the ledger: for each of 16 owner classes (`Sled, ScoreManager, TrickTracker, BsodPursuit, BsodBluffTracker, Hazard, BouncePad, TerrainMesh, MeshChunk, PowerUp, HintScheduler, GlitchDirector, ShardField, Shard, KodiakBear, RunScene`; `OWNER_SOURCES` names the file) every own enumerable property is mapped to the schema path that covers it (`FIELD_SOURCES`) or listed in `NON_CAUSAL` with a reason. The reflection tests (`tests/replay/fingerprintCompleteness.test.js`) fail when a property is in neither, and prove each `FIELD_SOURCES` entry by perturbing the real property and requiring the owning subsystem digest to change, so an entry is a verified claim, not a comment. Adding a property to those classes without classifying it fails CI. Scoped lint for `Math.random`, `Date.now`, `performance.now` in causal modules is a separate gate (Gate C in #152; `Date.now()` in `RunScene` for ids/timestamps is legitimate).

### 6.9 Team B interfaces and what they can rely on

- **#161 (cross-engine matrix, main consumer).** Compare `FingerprintResult.subsystems` per checkpoint across engines (digests are over IEEE bits, so any `Math.*` difference shows as a changed digest in the owning subsystem), then localize with the window scan and report `dumpState` field paths. Report rows: `{env, fixtureId, rulesetId, result: CompareResult}` where `env` is **the harness's own record** (engine/version/OS/arch/Hz/session index). A cheap addition Team B may make (not required by us): a `mathProbe` digest of fixed `Math.sin/cos/atan2/pow/tanh/log1p/hypot/sqrt` inputs per engine, to name suspect operations for #121. Until #165 lands, Team B's tool-local digests are fine. **What is stable now and safe to build on:** the BB-FP primitives (6.5), the subsystem names and order, `xxh32x2`, the `combined` construction, the interface signatures and `CompareResult` (6.6). **What is now FINAL (v1.1):** the per-subsystem field lists and schema versions of 6.3, so tool-local digests may adopt them verbatim; they change only by a per-subsystem version bump announced in #152. `compareRuns` is **async** and takes the `RunTrace` of 6.6; Team B's harness supplies `resimulate`/`dumpAt` (a real-game re-run from tick 0), which fits #161's per-tick matrix and its "first divergent tick/subsystem" report directly: `CompareResult` is the report row. Cross-engine note: `compareRuns` treats an irreproducible divergence or a re-simulation that does not hit the stored checkpoint as `inconclusive`, never as `diverged`.
- **#160 (presentation isolation).** Their per-tick digest can be replaced by `fingerprintState` with the same subsystem names. The contract makes their matrix a first-class test: for a fixed tape, fingerprints at every checkpoint MUST be identical across presentation perturbations (render cadence 30/60/120/144, viewport, zoom/shake, audio on/off, extra draws from `visual*` streams). Any difference is a **bug in the sim/presentation boundary**, not a schema issue. `updateGroundTelegraph` using `this._view.right` (#155): the contract classifies `warned`/telegraph state as *presentation* (not hashed). If #160/#155 shows it feeds causal state, that is a leak to fix and the field must then be added to the schema (subsystem schema bump).
- **#159 (savestate).** Our `sled`/`matter` field lists (now FINAL) are the *fingerprint* inventory and are a **subset by design** of what a restorable snapshot needs (a restorable snapshot additionally needs full per-body vertices/bounds/inertia, constraint and composite structure, `Common._nextId`, the pair table including identity). Names and field ownership above are intended to be reused verbatim for the shared parts. When #159 finds a hidden variable that affects the future, it should be added through #152 change control (a subsystem schema bump), so fingerprints and savestates share one inventory. Savestate digests stay diagnostic (their PR says so too).
- **#162 (fair input).** Section 4.4. Also: our hook is not in the `update()` loop (0.4).

### 6.10 Fingerprint reference vectors

Synthetic states (not a real run), schemas as in 6.3 where they exist; `sledPose` below is a **vector-only reduced schema** `{x,y,angle,vx,vy,angVel : f64}` (it is not the production `sled` schema), included so the BSOD-only example can show an unchanged "sled". `bsod` is produced by actually advancing `BsodPursuit({sledLeftEdgeX:12.5, level:1})` for 120 ticks of 2 substeps.

| subsystem | state | bytes (hex) | digest |
|---|---|---|---|
| `clock` v1 | `{tick:120, runTimeMs:1000.0000000000017, crashed:false}` | `01000000780000000f00000000408f4000` | `xxh32x2:ee0baf926a8ed6d3` |
| `rng` v1 | `{version:1, physicsScramble:1797135031}` | `0100000001000000b71a1e6b` | `xxh32x2:c100334bfc5d0aad` |
| `bsod` v1 | `{active:true, wallX:-7471.925000000001, wallSpeedPxS:116.14999999999895, accelerationPxS2:1.15, caught:false, bluff:{armed:false,usedCanopy:false,usedAirbrake:false,closestGapPx:null,previousGapPx:null,chain:0,lastAwardX:-Infinity,lastAwardTimeMs:-Infinity}}` | `0100000001ceccccccec2fbdc05099999999095d40666666666666f23f00000000000000000000000000000000f0ff000000000000f0ff` | `xxh32x2:eca47c91b23b1ae3` |
| `sledPose` v1 | `{x:1234.5678901234567,y:310.25,angle:0.1234,vx:7.5,vy:1.25,angVel:-0.0125}` | `01000000df0ffd84454a93400000000000647340f38e53742497bf3f0000000000001e40000000000000f43f9a999999999989bf` | `xxh32x2:4eab99674ff7efe1` |

Combined over order `[clock, rng, bsod, sledPose]` at tick 120: bytes `010000007800000004000000ee0baf926a8ed6d3c100334bfc5d0aadeca47c91b23b1ae34eab99674ff7efe1` -> `xxh32x2:84522c271965fe33`. After the 1-ulp `bsod.wallX` mutation: bsod `xxh32x2:4569b94722e48212`, sled unchanged, combined `xxh32x2:8772a8432c4e9b39`.

---

## 7. Ruleset identity and versioning (#123)

### 7.1 `rulesetId`

`rulesetId = sha256(canonical(ruleset))`. The **ruleset document** (`bb-ruleset` v1; VERIFIED against `ruleset.js` and the committed artifact) has exactly these top-level keys:

```
{ format:"bb-ruleset", formatVersion:1, simRevision,           // simRevision: hand-bumped int >= 1
  versions:{ draftRules, ghostPhysics, ghostTapeFormat:{id,version}, inputProtocol:{id,version}, kodiak, runRandom, tickHz },
  engine:{ constraintIterations, gravity:{x,y,scale}, matter, maxPhysicsStepMs, phaser, positionIterations, timeScale, velocityIterations },
  constants:{ 22 groups: biomeEffects, bsodBluff, bsodDefaults, hazardMotion, kodiak, permanentUpgrades, physics, physicsTuner,
              pixelsPerMeter, runRandom, runScene, scoring, shardMagnet, simClock, sled, terrain, terrainGenerator, terrainMesh,
              trickTracker, tuning, vocabulary, wards },
  tables:{ boostDefs, dailyRules, draft:{budget,rulesVersion}, upgradeCatalog },
  content:{ chunks, hazards, powerups, terrainMods, biomes } }  // each keyed by def id
```
**Assembly (so independent builders get the same bytes).** The document is assembled only from `src/systems/replay/rulesetRegistry.js` plus the content JSON handed in; `assembleRuleset` does no I/O and executes nothing it reads.
- **Registry.** Every **non-function export** of each of the 22 causal source modules has an explicit decision: INCLUDED at a dotted path in the document, or EXCLUDED with a written reason (>= 8 characters). A new export nobody classified makes assembly throw `unregistered-export`; a registered name the module no longer exports throws `stale-registry-entry`; two decisions writing the same path throw `duplicate-path`. Functions and classes are code, not data: they are covered by `SIM_REVISION` and the source tripwire, except class data (`DailyPatch.RULES`, via an explicit `statics` entry). Default when unclear: INCLUDE.
- **Source extraction** for modules that cannot be imported in Node (`RunScene.js`, `Shard.js`, `Sled.js`, `TerrainMesh.js`): their top-level numeric constants are **scanned from the source text** (never executed) and classified the same way (for example `constants.runScene.SAFE_SAMPLE_EVERY_MS`, `constants.sled.CAT`, `constants.terrainMesh.COLLIDER_DEPTH`); hint/camera constants are excluded as presentation.
- **Hidden literals** that no export carries are registry entries **pinned by source text** (the build fails if the pinned line disappears): `engine.positionIterations 8`, `velocityIterations 6`, `constraintIterations 2` (Matter default, VERIFIED not overridden by game, Phaser `World.js` or `main.js`; pinned in Matter's `Engine.js`), `gravity.x 0`, `gravity.scale 0.001` (Phaser `World.setGravity` default), `timeScale 1`, `constants.terrainGenerator.screenWidthPx 480`, `pxPerMeterDefault 20`. `engine.gravity.y` is derived (`PHYSICS.gravityPxS2 / 1000`, formula pinned in `RunScene`); `engine.phaser`/`engine.matter` come from the lockfile/bundled Matter.
- **Non-sim keys** are removed **recursively but only within one scope** (a content group or a table), so a display key can never hide a same-named key another reader treats as simulation. Each entry was checked against its readers. `hazards`: `name` (+ draw-only `shapeKey`, `colorKey`); `powerups`: `shapeKey`, `colorKey`; `terrainMods`: `colorKey`; `biomes`: `name, lore, background, palettes, unlockLevel`; `dailyRules`: `name, description`; `boostDefs`: `name`; `upgradeCatalog`: `label`; `kodiakDefs`: `name` plus draw-only `short, color, rim, accent`. **`basePrice` and `priceScale` are KEPT** (`draftCost` prices Daily Draft loadouts with them, so Draft legality depends on them: a price edit changes the id). Default is include.
- **Browsers do not re-assemble the ruleset** (assembly needs source text the bundle lacks). The game loads the **committed artifact**: `tools/ruleset/current.json` (`bb-ruleset-current`: `rulesetId`, `archivePath`, `canonicalBytes`, `simRevision`) points at `tools/ruleset/archive/<hex>.json`; the loader re-hashes the document against the pointer. CI runs `node tools/ruleset/build-ruleset.mjs --check`, which fails unless a fresh assembly of the source tree equals the archive file, the pointer is current, every archive file hashes to its name (archived rulesets are immutable), and the pins hold.
- **Real value at #166 `fc7f586` (supersedes the v1.0 illustrative id):** `sha256:ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27` (22,736 canonical bytes, `simRevision` 1). The pre-implementation estimate `sha256:7567d9ac...` in v1.0 is not a real ruleset; it survives only as the synthetic `ruleset-illustrative.json` fixture used by #164's tests. Not included: audio, UI strings, achievements, missions, cosmetics, palettes, the progression table.

### 7.2 `SIM_REVISION`, drift, and what constants cannot see

A rulesetId built from constants misses behavior in function bodies (C10: Sled geometry/density, contact logic, trick/landing rules, update order, `x > 480` style literals, Matter patching). So:
1. `SIM_REVISION` (hand-bumped integer in `src/systems/replay/ruleset.js`) is part of the document. **Bump it in the same PR as any change to causal code behavior**, even a bug fix, even when no constant moved. `LAST_RELEASED_SIM_REVISION` (not part of the document or id; **0 today**) is the revision of the last ruleset released on `main`.
2. Backstops: (a) golden canaries (#117) fail on unbumped drift because exact checkpoints change; (b) the **source tripwire** `tools/ruleset/source-digest.json` (`bb-source-tripwire`): SHA-256 of 28 causal source files (including `RunScene.js`, `Sled.js`, `GhostTape.js`; line endings normalized CRLF to LF), **not part of `rulesetId`**. `--check` fails when a file changed and `--attest` was not run. A change must carry one of **three attestation categories** (`^(no-behavior-change|sim-revision-bumped|behavior-change-unreleased): .{8,}$`):
   - `no-behavior-change: <why>`: format-checked only; a human attestation.
   - `sim-revision-bumped: <what>`: **must really bump**: `SIM_REVISION` has to exceed the previously committed one or the tool refuses.
   - `behavior-change-unreleased: <why>`: valid only while `SIM_REVISION > LAST_RELEASED_SIM_REVISION` (the revision has not been released, so behavior may change inside it without a bump). Today `LAST_RELEASED = 0` and `SIM_REVISION = 1`, so this category is valid; **in the PR that releases a ruleset set `LAST_RELEASED_SIM_REVISION = SIM_REVISION`**, from then on a behavior change needs a real bump.
   CLI: `build-ruleset.mjs` (print), `--write` (archive + pointer), `--check`, `--attest "<category>: <why>"`.
3. `SIM_REVISION` is independent of `package.json` version and of `GHOST_PHYSICS_VERSION` (kept for legacy mapping only).
4. **Known limits (stated, not hidden):** in-function literals are invisible to the id (tripwire and canaries are the net); the two-version proof of 7.5 uses a **toy simulation** because the live sim reads module globals and cannot yet be parameterized by a ruleset document.

### 7.3 Verifying under a different rulesetId

`resolveVerifier(manifest, registry)` (VERIFIED, `rulesetVerifier.js`) decides **which verifier may examine** a manifest and never runs one. `createRulesetRegistry({current, archive:[{ruleset, verifierId}], verifierAllowlist})` holds publisher-supplied data only: ruleset documents (the id is **always recomputed from the canonical bytes**; a file name or claim is never trusted) and the digests of publisher-built verifier bundles; nothing in the module loads, imports, evaluates or executes a bundle.

| Situation | Result |
|---|---|
| `X` is the current ruleset | `{status:"run", rulesetId, simRevision, verifierId:"in-game", historical:false}` |
| `X` archived with an allowlisted verifier bundle | `{status:"run", ..., verifierId:<bundle digest>, historical:true}` |
| `X` not registered | `{status:"refused", reason:"unknown-ruleset"}`; the current ruleset is never tried instead |
| `X` archived but no verifier registered, or its bundle not allowlisted | `refused` / `historical-verifier-required` (names the bundle digest, or null) |
| `rulesetId` null and `info.provenance` is `legacy-derived` | `{status:"legacy-only", verifiedUnder:<current id>, verifierId:"in-game", allowedOutcomes:["consistent-with","inconclusive-legacy"]}` (5.3) |
| `rulesetId` null, not legacy | `refused` / `null-ruleset-not-legacy` |
| `simRevision`, `tickHz` or `engine` missing with a non-null id | `refused` / `malformed-manifest` (consistency copies are required whenever the id is non-null) |
| those copies disagree with the ruleset | `refused` / `ruleset-field-mismatch` (field named) |
| id not `sha256:<64 hex>` | `refused` / `malformed-ruleset-id` |

A mismatch is never auto-repaired by reinterpreting old settings under the current ones.

### 7.4 Outcome record

`OUTCOMES = match | diverged | consistent-with | inconclusive-legacy | refused`. A record has the keys `outcome, verifiedUnder, verifierId, tapeDigest, manifestDigest` and optionally `firstDivergence` (a `CompareResult`, `diverged` only), plus `reason` and `claimedRulesetId` for a `refused`. A `refused` record has `verifiedUnder` and `verifierId` both null. **Unknown keys are rejected** (a stray boolean `verified` included). `makeOutcomeRecord({outcome, resolution, ...})` takes the ruleset and verifier from the **resolution**, never from the manifest's claim, and refuses an outcome the resolution does not allow (a `refused` resolution can only produce `refused`; `run` produces `match`/`diverged`; `legacy-only` produces the two legacy outcomes). `validateOutcomeRecord` re-checks any record read back from storage. The validation outcomes of 4.2 (`valid` / `inconclusive` + reasons) are a different vocabulary; mapping an `inconclusive` validation onto a verification outcome is an open item (section 10).

### 7.5 Scoreboards and artifacts

- **Scoreboards MUST key on `rulesetId`.** `scoreboardKey({rulesetId, lane, biomeMask, seed|null})` = canonical text of `{format:"bb-board-key", rulesetId, lane, biomeMask, seed}`; a null/legacy id has no board. **Only a validated `match` record may appear on a board** (`ineligibleReason`: `legacy-outcome`, `refused`, `diverged`, `invalid-record`, `not-a-record`). `partitionByRuleset` never merges; each partition reports `historicallyValid:true` and, given the current id, `currentlyEligible` (historical validity and current eligibility are separate fields). A board that spans rulesets is only produced by an explicit `crossRulesetView` (`kind:"cross-ruleset"`); mixing otherwise throws `RulesetMixError`. These modules are library-only: nothing in gameplay imports them, and the local ledger is untouched (a ledger link needs a V5 hash: Q6).
- Ruleset documents and manifests are small and archived by content hash (cheap, immutable). Executable verifier bundles are archived **only when code behavior diverges from what the current implementation can reproduce**; they are publisher-built, hash-allowlisted, never uploaded by players and **never executed from input**. Retention of the bytes is a promise; ability to *run* an old verifier is a separate, weaker promise (Q3).
- **Two-version proof (#123 acceptance), stated honestly:** `rulesetTwoVersion.test.js` exercises *selection and partition* with a toy deterministic simulation whose behavior is read from the ruleset document (a changed `hopPxS`, `parachuteDurationMs` 880 to 800 and a `SIM_REVISION` bump): the verifier named by the manifest's ruleset is chosen (never the current one as a fallback), unknown/relabelled/un-allowlisted cases are refused, outcome records name ruleset and verifier, and boards never mix rulesetIds. It does **not** run the real game under two rulesets.

---

## 8. Test fixtures and reference vectors

### 8.1 Location (matches the declared scopes of #163: `docs/replay/**`, `src/systems/replay/canonical*`, `tests/**/replay*`)

```
docs/replay/replay-contract-v1.md                 (this document, canonical copy)
tests/fixtures/replay/v1/README.md                (vectors are never auto-regenerated)
tests/fixtures/replay/v1/index.json               every shipped vector id, per file
tests/fixtures/replay/v1/cjson-valid.json         cj-001 .. cj-011
tests/fixtures/replay/v1/cjson-reject.json        rj-001 .. rj-043
tests/fixtures/replay/v1/hash-vectors.json        sha256 (NIST), xxh32, xxh32x2, f64
tests/fixtures/replay/v1/fingerprint-vectors.json BB-FP schemas, states, bytes, digests, combined, BSOD-only mutation
tests/fixtures/replay/v1/fingerprint-schemas-v1.json   regression lock of the 13 production schemas (#165; implementation-produced)
tests/fixtures/replay/v1/manifest-v1.example.json      (8.2; #164)
tests/fixtures/replay/v1/manifest-legacy.example.json  (8.3; #164)
tests/fixtures/replay/v1/legacy-tape.json              the 8.3 tape (#164)
tests/fixtures/replay/v1/ruleset-illustrative.json     synthetic ruleset used by the 8.2 example (NOT a real ruleset; #164)
tests/replay/*.test.js                            Jest ESM tests consuming the above
```
**Vector index.** `tests/fixtures/replay/v1/index.json` lists every shipped vector id per file (`cj-001..011`, `rj-001..043`, hash and fingerprint vectors) and the tests check it against the files; cite it rather than this document for ids. In the fixtures the **hex** (`hex` for valid vectors, `inputHex` for parse-level rejections) is authoritative; text copies exist only where the text is printable ASCII, and anything invisible or non-ASCII is written as explicit `\u` escapes in the JS descriptor. The tables in section 2.4 are the human-readable summary. Locations are JSON Pointers (2.3).

Fixtures are checked in as bytes and verified by tests; a test that regenerates and overwrites them is forbidden. Changing a committed vector is a breaking change (section 9).

### 8.2 Manifest example (scratch tape, synthetic content)

Canonical bytes (1,805 B, single line): `manifestDigest = sha256:10b767906b482e262cee3e042c6877b9edbfd1cc2875f83dd59e02b1ecb5a91f`, `causalDigest = sha256:1e1211bc3b76d51845420152c2648d198e6d5555f9f35ea1e56b5452e4a91a25`. Its `rulesetId` is `sha256:7567d9ac84285bc38ad6283c64ec58d7ebec73ced44f894a661e208ae861c0ce`, the digest of the synthetic `ruleset-illustrative.json` fixture (**not a real ruleset**; the real id is in 7.1). `dailyRuleId` is `featherweight` because 2026-11-21 UTC selects that rule (a normal seed, so the rule came from the clock: C1). The pose, `leftEdgeX = 41.5` (`f64:4044c00000000000`) and BSOD initial values are synthetic but mutually consistent: `wallX = 41.5 - 7600 - 900*log1p(0) = -7558.5 = f64:c0bd868000000000`, `accelerationPxS2 = 1.15 / (1 + 0*0.17) = 1.15`.

```json
{"causal":{"bsod":{"initial":{"accelerationPxS2":"f64:3ff2666666666666","wallSpeedPxS":"f64:405cc00000000000","wallX":"f64:c0bd868000000000"},"leftEdgeX":"f64:4044c00000000000","syncLevel":1},"checkpoints":{"algo":"xxh32x2","detail":"combined","everyTicks":120,"schemas":{"bsod":1,"clock":1,"effects":1,"hazards":1,"kodiak":1,"matter":1,"pickups":1,"recovery":1,"rng":1,"score":1,"sled":1,"terrain":1,"tricks":1}},"course":{"biomeMask":0,"dailyRuleId":"featherweight","dailyRuleSource":"clock-at-start","seed":"RPLAY59"},"input":{"bits":{"bool":["push","variableHop","noAutoNudge","divebomb","corkscrew","tuck","brakeHeld","hop","reset","airBrake","parachute","pause"],"edge":["hop","reset","pause","airBrake","parachute","confirm"],"heliShift":18},"edgeRows":"every-tick","endTick":600,"protocol":"bb-pad","protocolVersion":1,"tapeDigest":"sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23","tickHz":120,"tiltScale":127},"kodiak":{"enabled":false,"packMode":"same","version":2},"loadout":{"boosts":[],"magnetsDrop":false,"upgradeRanks":{}},"rng":{"physicsScramble":1037858759,"version":1},"sim":{"engine":{"matter":"0.20.0","phaser":"3.90.0"},"rulesetId":"sha256:7567d9ac84285bc38ad6283c64ec58d7ebec73ced44f894a661e208ae861c0ce","simRevision":1,"tickHz":120},"start":{"pose":["f64:404dbfffffffffff","f64:c0203f35ba6e8dec","f64:3fbacee9f37bebd5","f64:3fe999999999999a","f64:3fb1eb851eb851ec","f64:0000000000000000"],"tick":0}},"critical":[],"ext":{},"format":"bb-replay-manifest","formatMinor":0,"formatVersion":1,"info":{"gameVersion":"2.15.1","inputCapture":{"edgeAssignment":"frame-first-tick"},"lane":{"dailyMode":"classic","dailyOfficial":false,"mode":"normal"},"provenance":"live-recording","rngVisual":{"visualCamera":699437410,"visualFx":2914981907,"visualSled":1630249723}}}
```

**8.2b Live-path manifest (implementation output, #164 `4eaa371` + #166 `fc7f586`).** The same tape with the header RunScene now writes, built by `buildManifest` with the **real** ruleset `sha256:ecb2017a...7c78c27` and the production schema versions, validates `ok:true, outcome:"valid", reasons:[], warnings:[]` (and `warnings:["ruleset-checks-skipped"]` when no resolver is given). It differs from 8.2 only in `sim.rulesetId` (real id), `checkpoints.schemas` (`sled:2, matter:2`, all others 1) and a new `info.capture:{errorCount:0}`; canonical bytes 1,832 B, `manifestDigest = sha256:8dbf9239eae6f8990d380a08700b3409516d29e91b78a26d5fc05906cc44f718`, `causalDigest = sha256:45d31fdba6287e7235b642c31c3156e5e6bdcbf67f94c6c21d3edc89687b916e`. (The committed #164 fixture still carries the synthetic 8.2 values; regenerating it is a follow-up.)

### 8.3 Legacy-derived example

From a real-format tape produced by the repo's `GhostRecorder` with the `b51ab36` header shape (`seed RPLAY59`, 600 ticks, kodiak fields present and `kodiaksOn:false`): `causal.sim = {rulesetId:null, simRevision:null, tickHz:120, engine:null}`, `causal.bsod = {syncLevel:null, leftEdgeX:null, initial:null}`, `causal.input.edgeRows = "legacy"`, `causal.checkpoints = {algo:null, detail:"none", everyTicks:120, schemas:null}`, `info.provenance="legacy-derived"`, `info.legacy = {format:"bb-ghost-tape", version:1, physicsVersion:1, exactSledCheckpoints:5, absentFields:[]}`. Canonical bytes 1,417 B, `sha256:391c00aaca4090df31a4c9df48f117c9b8f8158c86f1d6a0437da13d06ce3535` (reproduced byte-for-byte by `legacyManifestFromTape` at `4eaa371`):

```json
{"causal":{"bsod":{"initial":null,"leftEdgeX":null,"syncLevel":null},"checkpoints":{"algo":null,"detail":"none","everyTicks":120,"schemas":null},"course":{"biomeMask":0,"dailyRuleId":"featherweight","dailyRuleSource":"recorded","seed":"RPLAY59"},"input":{"bits":{"bool":["push","variableHop","noAutoNudge","divebomb","corkscrew","tuck","brakeHeld","hop","reset","airBrake","parachute","pause"],"edge":["hop","reset","pause","airBrake","parachute","confirm"],"heliShift":18},"edgeRows":"legacy","endTick":600,"protocol":"bb-pad","protocolVersion":1,"tapeDigest":"sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23","tickHz":120,"tiltScale":127},"kodiak":{"enabled":false,"packMode":"same","version":2},"loadout":{"boosts":[],"magnetsDrop":false,"upgradeRanks":{}},"rng":{"physicsScramble":1037858759,"version":1},"sim":{"engine":null,"rulesetId":null,"simRevision":null,"tickHz":120},"start":{"pose":["f64:404dbfffffffffff","f64:c0203f35ba6e8dec","f64:3fbacee9f37bebd5","f64:3fe999999999999a","f64:3fb1eb851eb851ec","f64:0000000000000000"],"tick":0}},"critical":[],"ext":{},"format":"bb-replay-manifest","formatMinor":0,"formatVersion":1,"info":{"lane":{"mode":"normal"},"legacy":{"absentFields":[],"exactSledCheckpoints":5,"format":"bb-ghost-tape","physicsVersion":1,"version":1},"provenance":"legacy-derived","rngVisual":{"visualCamera":699437410,"visualFx":2914981907,"visualSled":1630249723}}}
```

Further fixtures: remove `kodiaksOn/kodiakPackMode/kodiakVersion` => the `kodiak` module is omitted; remove `magnetsDrop` => `loadout.magnetsDrop:null`, `absentFields:["magnetsDrop"]`, strict verification refused (C3).

### 8.4 Canary fixture envelope (to be consumed by #117/#158, not duplicated)

#158 currently has no fixture format. Proposal so it needs none: a canary fixture is a `bb-replay-evidence` bundle (`detail:"full"`) plus `manifest.ext.canary = {id, covers:[...], expects:{...}}` (non-critical). `covers` is a list of behavior tags the harness must observe activating during the replay (rolling hazard active, BSOD catch, parachute+wind, flip landing...), so "scenario name only" is not enough. #158 can implement the harness first and adopt the envelope once #163 merges; a fixture that needs extra metadata uses `ext`, never a new top-level key. Canaries use `full` checkpoints so a divergence names its subsystem. Canary fixtures live in `tests/canaries/**` (#158's scope), not under `tests/fixtures/replay/v1/` (contract vectors).

### 8.5 Required tests (summary)

(1) every `cjson-valid` vector reproduces text/hex/SHA; every `cjson-reject` fails with the code and JSON Pointer; (2) pure-JS SHA-256 == `node:crypto` == vectors; (3) bytes-XXH32 == repo `xxHash32` on shared inputs; (4) fingerprint vectors incl. the BSOD-only mutation; (5) manifest validator: every unknown-field rule in 4.2, consistency checks, `critical` handling, non-canonical bytes; (6) `tapeDigest` ignores `trace`/`startedAt` and normalizes `-0`; (7) legacy mapping incl. absent Kodiak/`magnetsDrop`; bb-pad refusals (heli 3, undefined bits, `dt<1`, `tilt127` range, rows beyond `endTick+1`); consecutive-tick edge rows (C11) round-trip; every cross-field check of 4.2.8 including the BSOD formula; (8) reflection completeness (6.8); (9) evidence store survives `GhostLibrary._collect` and a reload, and reports quota failure; (10) same tape replays under a faked clock on different days and different profile levels (R-1/R-2 are in #164; acceptance for #116; `liveReplayAcceptance.test.js`); (11) ruleset: assembly determinism, unregistered/stale export, hidden-literal pins, tripwire attestation rules, `--check`; (12) `compareRuns` outcomes of 6.6 incl. `resim-does-not-reproduce-checkpoint`; (13) evidence store: put/get/remove, `importBundle` digest requirement, quota/write failure, deferred live path.

---

## 9. Change control

- **Where published:** every revision is a numbered comment in #152, titled `Replay Contract v1.N`, with a **changelog** and a link to the exact commit of `docs/replay/replay-contract-v1.md` and the fixtures. Team B reads #152; PR bodies link the contract version they implement. The version in the doc header is authoritative.
- **Freeze event (v1.1):** the 6.3 field lists are **FINAL**, frozen at the per-subsystem versions listed there (`sled 2, matter 2`, all others 1). From now on they change only by a per-subsystem version bump under the rules below. (The v1.0 text allowed pre-freeze edits; the v1.1 changes to `sled`/`matter` are those, hence NON-BREAKING.)
- **Non-breaking (v1.N, N+1):** new `info` fields; new `ext` keys; new optional error detail; new vectors; clarifications; **new subsystem fields before the first fingerprint fixture is merged**; additional canonical error codes; new `critical`-flagged extensions (old readers refuse them by design).
- **Breaking (needs v2.0 or a per-component version bump, a migration note, and a retained reader for the old version):** changing any serialization rule in section 2 or any committed vector; changing a hash input, seed, or encoding (BB-FP, `xxh32x2`); changing a required field's meaning; adding/removing/reordering a *causal* field or subsystem after the first fingerprint fixture exists (per-subsystem `schemaVersion` bump, old fixtures remain valid under old schema version); changing `bb-pad` bit layout (protocol version bump); changing `rulesetId` assembly rules (the documented sources/denylist); renumbering `FP_SUBSYSTEMS`; moving the evidence store.
- **Interfaces Team B can rely on (stable for v1):** BB-CJSON v1 and its error codes; `sha256:`/`xxh32x2:` formats; `bb-replay-manifest` v1 field paths and 4.2 policy; BB-FP encoding and subsystem names/order; `FP_*` constants; `captureCausalState/fingerprintState/dumpState/compareRuns` signatures (`compareRuns` is async as of v1.1) and `CompareResult` shape; `bb-pad` v1 (4.4); the evidence bundle shape; the manifest field table; the 6.3 field lists (FINAL); the rule that RunScene's `update()` loop is untouched by us. Anything not listed (internal helper names, file layout under `src/systems/replay/` beyond the file-name prefixes, the scratch reference code) can change.
- **Coordination rule:** a *sim behavior* change by Team B that adds causal state MUST update the field table/schema in the same PR (the reflection test forces it), bump `SIM_REVISION`, and announce in #152.

---

## 10. Open questions, follow-ups, owner decisions

Resolved in v1.0/v1.1: (a) who edits `RunScene.create` for R-1..R-3: Team A in #164 (done); (b) legacy defaults for magnet/Kodiak/Sync Level/rule: decided from git history (5.3).

Open questions (owner decisions):
1. Retention window for **local** evidence: keep all until the user deletes (implemented: no auto-eviction), cap by bytes with a visible prompt, or by count? Default export location?
2. Reference verifier: pinned headless Chromium running the real game vs portable math (#120/#121 evidence). This contract is neutral: it only makes divergence visible. A pinned Chromium verifier does not prove a Safari-recorded run matches it.
3. Support horizon for historical verifiers (time-limited execution vs indefinite archive-only), and who maintains security patches for pinned old browsers.
4. Seeds with lone surrogates: reject at input (sanitize), or keep "evidence-ineligible" (implemented)?
5. Whether `combined` checkpoint detail is enough for the default local archive (implemented), or `full` should be the default (4.7 KB vs ~45 KB per 3 minutes, estimated).
6. Bind ledger record -> evidence (a new `RunRecord` field needs a V5 hash and a `sanitizeRun` whitelist; today it would be silently dropped) or keep the local index only?
7. Privacy/consent copy for exporting evidence (seed may contain PII; input timing is behavioral data; digests are linkable ids), and COPPA review before any upload (#135).
8. Mapping a validation `inconclusive` (4.2: `bsod-initial-divergence`, `fingerprint-capture-errors`) onto the verification outcome vocabulary of 7.4 (`match`/`diverged`/...): not yet specified.

Follow-ups (known work, not changes to this contract):
- R-1 should resolve the daily rule through the ruleset table (`tables.dailyRules`), not the live `DailyPatch.RULES` (equivalent at `SIM_REVISION` 1).
- `registry['lastEvidenceStatus']` has no UI consumer yet (failures reach only `console.warn` and the registry).
- No terminal capture at the crash tick (needs a hook outside `afterTick`; harness responsibility).
- C12, the palette-toggle leak, for Team B (#140/#160); `blindMs`/`warned`/telegraph classification (`NON_CAUSAL`) still to be confirmed by #140/#155.
- Regenerate the #164 `manifest-v1.example.json` with the real ruleset id and production schema versions (8.2b); a real-game two-version proof once a ruleset can parameterize the sim.

---

## 11. Implementation status and file map

Principle (unchanged): pure modules under `src/systems/replay/` (no Phaser import, importable from Jest), thin hooks, **no edits to the `update()` loop**. All four PRs are drafts; commits are the ones this document was checked against.

| PR (issue) | Commit | Lands |
|---|---|---|
| #163 (#152) | `aac32b4` | `docs/replay/replay-contract-v1.md`; `canonicalJson.js` (`canonicalize/canonicalBytes/parseCanonical/CJSONError/f64Encode/f64Decode/canonicalSelfTest/asUint8Array`, UTF-8 helpers, `MAX_*`), `canonicalSha256.js` (`sha256Hex/digestOf/digestOfBytes/sha256SelfTest`), `canonicalBinary.js` (`xxh32Bytes/xxh32x2/fingerprintOf/FpWriter/combineFingerprints`); vectors under `tests/fixtures/replay/v1/` and `tests/replay/canonical*.test.js`. `Rng.js` `xxHash32` untouched. |
| #165 (#118) | `f3fc93d` | `fingerprintSchemas.js` (13 schemas, `FIELD_SOURCES`, `NON_CAUSAL`, `OWNER_SOURCES`), `fingerprintCapture.js`, `fingerprint.js`; `GhostTape.js` (`_fingerprint`, `fingerprints`, `fingerprintErrorCount`); tests and the schema-lock fixture. **No `RunScene.js` change.** |
| #166 (#123) | `fc7f586` | `ruleset.js`, `rulesetRegistry.js`, `rulesetVerifier.js`, `rulesetScoreboard.js`; `tools/ruleset/{build-ruleset.mjs, lib.mjs, current.json, archive/<hex>.json, source-digest.json}`; `docs/replay/time-capsules.md`; tests. Library-only: nothing in gameplay imports the verifier or scoreboard. |
| #164 (#116) | `4eaa371` | `manifest.js` (`buildManifest`, `validateManifest`, `legacyManifestFromTape`, `evidenceBundle`, `validateEvidenceBundle`, `resolveReplaySetup`, `tapeDigest`), `evidenceStore.js`, `evidenceCapture.js` (`scheduleRunEvidence`), `runtimeRuleset.js`; `GhostTape.js` (`-0` normalization, edge rows, `edgeRows` header, plus #165's hook); **`RunScene.js`**: `resolveReplaySetup` use in `create()` (R-1..R-4), `_ghostHeader` (adds `dailyRuleSource`, `syncLevel`, `bsod{leftEdgeX, initial}`), one deferred call in `_saveGhostTape`; `services.js`: a dynamic import that loads the runtime ruleset. |

RunScene.js budget actually used: `_ghostHeader`, the replay-setup branch of `create()`, one line in `_saveGhostTape`; no `update()` edits.

---

## Appendix A: Team B alignment matrix

| PR | Their scope | Our interaction | Incompatibility today |
|---|---|---|---|
| #159 (#119) | `docs/determinism/**`, `tools/savestate-experiment/**`, `tests/determinism/savestate-*`; no `src/` | Field inventory shared; ours is fingerprint subset; additions via #152 | None |
| #160 (#140) | `tools/conformance/**`, `tests/determinism/**`, `docs/determinism/**`; may fix proven leaks in `src/**` | Replace diagnostic digest with `fingerprintState`; presentation isolation is a contract test; `updateGroundTelegraph` leak left to #155; **C12 (palette toggle) handed over for confirmation** | Possible RunScene textual overlap only if they edit `_ghostHeader`/the replay-setup branch of `create()` (they should not) |
| #161 (#120) | `tools/conformance/cross-engine*`, fixtures, `docs/determinism/**` | Main consumer: per-subsystem digests, `compareRuns`, `dumpState`; recorded fixtures via `GhostRecorder` are legacy tapes today, use `legacyManifestFromTape` until #164 lands | None. Their Chromium-recorded tapes carry `-0` risk (C4) and no Sync Level (C2); legacy outcomes are `consistent-with` only |
| #162 (#115) | `InputRouter`, `VirtualPad`, `SimClock`, `RunPad`, **RunScene update input glue**, tests | v1 tape unchanged; capture policy recorded in `info.inputCapture`; protocol bump only if a new recorded quantity is needed. #164's recorder change (edge rows) affects which rows are *written*, not their meaning | No overlap: #164's RunScene edits are `create()` replay setup, `_ghostHeader` and `_saveGhostTape`; the fingerprint hook is in `GhostTape.js`. They explicitly do not touch the tape format |
| #158 (#117) | `tools/canaries/**`, `tests/canaries/**` | Adopt evidence-bundle envelope (8.4) | Fixture format not yet defined |

---

## Appendix B: Driving a replay (`b51ab36` baseline; #164 changes step 2)

For an engineer who has never seen the repo. Steps 1, 3-6 are true on `b51ab36` and on the #164 branch. **Step 2 describes `b51ab36`; on the #164 branch (`4eaa371`) `RunScene.create` calls `resolveReplaySetup` and the manual pinning below is unnecessary** (it resolves rule, Sync Level, Kodiak/magnet flags and ignores the registry flags; legacy tapes get the defaults of 5.3, reported in `defaulted`).

1. **Start a replay.** In a browser page with the built game: `window.__bbGame.registry.set('ghostReplay', tape)` (`REG.GHOST_REPLAY`), then `window.__bbGame.scene.getScene('TitleScene').startRun(seed)` with the tape's seed (`tools/ghost-tape-browser-smoke.mjs`, `drive()` is a working example; `tools/replay-determinism-browser-probe.mjs` shows exact frame stepping by holding `RunScene.update`, sleeping the loop, and calling `game.step(t, dt)`). `RunScene.create` removes the registry key after reading it. During replay the scene never saves a record, awards progress, or records a tape.
2. **What the tape drives (on `b51ab36`):** `seed`, `biomeMask`, `upgradeRanks`, `boosts`, and (if present) `magnetsDrop`, `kodiaksOn`, `kodiakPackMode`. **What it does not:** the daily rule, the BSOD Sync Level, and the `REG.*` flags (C1, C2, R-4). Until #164, pin these yourself before `startRun`:
   - **UTC date:** `DailyPatch.getDailyInfo()` reads `new Date()`. Fake the clock (e.g. Playwright `page.clock`) to any instant whose rule matches: the rule index is `Math.floor(epochMs / 86400000) % 8` into `DailyPatch.RULES` (order: `tuckBoost, heavyPackets, featherweight, slickLines, stickyBits, airDancer, stiffNeck, turboTuck`), and compare with the tape's `dailyRuleId`. A `daily-YYYY-MM-DD` seed uses that date's rule regardless of the clock.
   - **Profile level:** set `registry.get('profile').level` to the Sync Level of the recorder (unknown for legacy tapes). It feeds `BsodPursuit` and, only for tapes that lack the fields, `magnetsDrop` (level >= 5) and Kodiaks (level >= 6).
   - Set registry `bsodGymMode` false, `dailyOfficial` false, `dailyMode` `'classic'`.
3. **Input semantics.** `TapePlayer.padAt(tick)` is called with 1-based ticks; row/tick/edge rules are exactly section 4.4. `TapePlayer.check(tick, scene)` compares the seven-number sled checkpoint (`[x,y,angle,vx,vy,angVel,score]`) with `!==` at ticks that are multiples of 120 and stores the first mismatch in `desync`. Edges on consecutive ticks are lost in tapes recorded by the current recorder (C11).
4. **Tick and substeps.** `SIM_TICK_HZ = 120`, `SIM_TICK_MS = 1000/120` (8.3333... ms). `simTick(dt)` calls `stepWorld(world, simDt, ...)`: `n = max(1, ceil(simDt / 8))`, `step = simDt / n`, where `simDt = dt * (slowmo ? slowmoScale : 1)`, then `*0.35` while `blink`, and `0` during hit-stop (no substeps). At normal speed `n = 2` and `step = 4.1666...` ms. BSOD, sled controls and contact processing run per substep; `runTimeMs += dt` per tick (an accumulated double).
5. **`xxHash32(str, seed = 0)`** (`src/systems/Rng.js`): XXH32 of the **UTF-8 bytes** of `String(str)` with 32-bit seed `seed`; a lone surrogate is encoded as a 3-byte sequence from its code unit (WTF-8 style), unlike `TextEncoder` (C7). `new Rng(seedString)`: state = `xxHash32(seedString)`. `fork(label)` = `new Rng(xxHash32(label, baseSeed))` where `baseSeed` is the **original** state. `next()` is mulberry32 on a uint32 state. Streams: `physics/scramble`, `visual/sled`, `visual/fx`, `visual/camera`.
6. **Where fixtures live.** Contract vectors: `tests/fixtures/replay/v1/` on the #163 branch (`cc-friday/issue-152-replay-contract`); the #164 branch adds `legacy-tape.json` (a real-format, pre-fix tape, 600 ticks, synthetic content) and the manifest examples. There are no committed real tapes at `b51ab36` (only `tests/fixtures/pacing-handsOff.json`, unrelated); record tapes with the smoke tool above. Canary tapes will live in `tests/canaries/**` (#158).

---

## Changelog

### v1.1 (2026-11-21)

Supersedes v1.0 (commit `a5e7b47`). Full text: `docs/replay/replay-contract-v1.md` (commit linked from the PR #163 branch); this comment is a self-contained list of what changed since v1.0, each item tagged **BREAKING** or **NON-BREAKING** by the rules of section 9. v1.1 was written after reading the implementations, which are all still draft PRs: #163 `aac32b4` (canonical JSON, SHA-256, BB-FP), #165 `f3fc93d` (fingerprints), #166 `fc7f586` (rulesets), #164 `4eaa371` (manifest, evidence store, live path). Where v1.0 and that code differed, the code won and the text was corrected.

Section numbers below are those of the contract.

#### BREAKING (2)

1. **BREAKING, section 7.1: the `rulesetId` assembly rules and document layout** are replaced by the implemented ones. The v1.0 sketch is superseded by a registry model: the document has `versions` (`draftRules, ghostPhysics, ghostTapeFormat{id,version}, inputProtocol{id,version}, kodiak, runRandom, tickHz`), `engine` (`constraintIterations, gravity{x,y,scale}, matter, maxPhysicsStepMs, phaser, positionIterations, timeScale, velocityIterations`), `constants` (22 groups), `tables` (`boostDefs, dailyRules, draft, upgradeCatalog`) and `content` (five groups). Every non-function export of 22 causal modules is INCLUDED or EXCLUDED-with-reason (an unclassified export or a stale entry fails assembly); module constants that cannot be imported in Node are scanned from source text; hidden literals (`positionIterations 8`, `velocityIterations 6`, `constraintIterations 2`, `gravity.x/scale`, `timeScale`, `screenWidthPx 480`, `pxPerMeterDefault 20`) are pinned by source text. Non-sim keys are removed recursively **per scope** (per table / content group), and the v1.0 flat denylist changed: **`basePrice` and `priceScale` are now KEPT** (Daily Draft pricing depends on them), draw-only keys were added (`shapeKey`, `colorKey`; Kodiak `short, color, rim, accent`). **The real id at #166 is `sha256:ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27`** (22,736 canonical bytes, `SIM_REVISION` 1); the v1.0 illustrative `sha256:7567d9ac...` is void (it survives only as a synthetic test fixture). No real id existed before, so no data needs migrating; anyone who computed an id from the v1.0 text must recompute.
2. **BREAKING, section 6.6: `compareRuns` is now async** (`Promise<CompareResult>`), and its `RunTrace` contract is defined: `{causalDigest, manifestDigest?, endTick?, checkpoints:[{tick, combined, subsystems?}], resimulate({fromTick,toTick}) -> per-tick FingerprintResult[], dumpAt(tick) -> CausalState}`. Results are stricter than the v1.0 text: a missing causal digest, empty checkpoints, a checkpoint list that is not exactly ticks 120, 240, ... (`checkpoint-gap`), a malformed re-simulation window, a divergence that does not reproduce, or a re-simulation that does not hit the stored checkpoint are all `inconclusive` (never `match`, never `diverged`); a differing `endTick` is `diverged`. v1.0 listed the synchronous signature as stable.

#### NON-BREAKING (new facts, finalizations, clarifications)

**Section 6 (#165): field lists are now FINAL** (frozen at `clock 1, rng 1, sled 2, matter 2, terrain 1, hazards 1, pickups 1, effects 1, bsod 1, kodiak 1, score 1, tricks 1, recovery 1`; later changes need a per-subsystem version bump). NON-BREAKING by section 9 because the v1.0 text allowed field edits until the first fixture reaches `main`; Team B tool-local code that copied the v1.0 *provisional* lists must update. Differences from the v1.0 table:
- `sled` v2: `flags.shield` removed (NON_CAUSAL, render-time mirror); `inWorld`, `destroyed` are causal (`flags`); `lastPad` is `opt<{bits,tilt127}>`; `canopyFuelFullMs`, `preVx`, `preVy` are `opt<f64>`; `geyserCooldownMs`, `crawlMs` are `x ?? 0`; `parts` exclude the compound root.
- `matter` v2: adds `lastDelta` and `gravity{x,y,scale}`; per-pair `contactCount` plus both warm-start contact slots; `staticOrder` lists every static body with `padLast` (`opt<f64>`, bounce-pad cooldown stamp); `bodies` = BODYF plus parts, sled root excluded by id.
- `terrain.chunkDigests`: specified exactly as the **GV1 generic encoding** of each joined chunk object (tags 0-6; record keys in UTF-16 order; depth <= 24; a recycled chunk digests as `absent`); any new property on chunk objects changes every digest.
- `hazards`: `nearMissed`, `side`. `pickups`: `liveShards`. `effects`: `magnetEff{pullRadiusPx,pullPxS}`, `wards{id,msLeft,mods,hazards,effects,speedFactor}`. `recovery`: `safeSamples{t,x,y,vx,vy,ang}`. `score`: `bonusCounts`/`bonusByKind` are f64 triples.
- Also: `dumpState` key order is canonical (`tick`, then schema order) with `<path>.length` entries; `CompareResult.differingPaths` (additive); `fingerprintState` result carries `fp`; capture failures are counted in `GhostRecorder.fingerprintErrorCount` and never break a run; the anti-drift ledger (`FIELD_SOURCES`, `NON_CAUSAL`, 16 owner classes) is described; **terminal capture at the crash tick: still none** (harness responsibility).

**Section 2 (#163):** per-index descriptor checks for arrays (`accessor`, `hidden-property`, `sparse-array` at `/<index>`, getters never invoked); a bounded-memory iterative parser past depth 32; byte inputs are only `Uint8Array`/`ArrayBuffer` (hashing functions throw `TypeError` for other views; `parseCanonical` reports `unsupported-type:object`); exported `canonicalSelfTest()` and `sha256SelfTest()` at module load; the Proxy limitation is documented; `canonicalize` validates all keys of an object before descending (document order is a `parseCanonical` property); stage-numbering typo fixed ("after stage 6").

**Sections 4, 5 (#164):**
- New refusal codes: `inconsistent-field` (a failed 4.2.8 cross-field check), `unknown-ruleset`, `ruleset-digest-mismatch`, `invalid-ruleset`, `invalid-input-row`, `digest-mismatch`, `evidence-ineligible`, `invalid-run-context`, `unknown-daily-rule`. `validateManifest`/`validateEvidenceBundle` return result objects (`{ok:false, code, pointer}` or `{ok:true, ..., outcome:"valid"|"inconclusive", reasons, warnings}`) and never throw for bad input. Warning `ruleset-checks-skipped` when there is no ruleset resolver. `formatVersion` is checked before unknown envelope keys.
- New info key `info.capture.errorCount`: non-zero drops the fingerprints (`detail:"none"`) and makes validation `inconclusive` with reason `fingerprint-capture-errors`; `bsod-initial-divergence` (already in v1.0) is implemented as `inconclusive`.
- `causal.input.edgeRows`: the tape header now carries `edgeRows:"every-tick"`; a tape without it is `"legacy"`. The C11 recorder fix is implemented; `GhostRecorder` also normalizes `-0` (C4). The tape header gains `dailyRuleSource`, `syncLevel`, `bsod{leftEdgeX, initial}`.
- **Legacy replay defaults** (5.3), decided from git history and reported in `resolveReplaySetup(...).defaulted`: `magnetsDrop` absent => **ON** (tapes `da8935a` predate the magnet gate and header field `3b6b961`), Kodiak fields absent => off (`44e291c` postdates every such tape), `syncLevel` absent => 1, `dailyRuleId` null => no rule. Strict verification then reports reduced guarantees. R-1..R-4 are implemented (C1-C3 fixed), R-5 is the recorder fix.
- Evidence store (1.2): a separate database with an **index only** (`{digest,size,runId,seq}`, no wall-clock values); `importBundle` requires `expectedDigest`; `navigator.storage.persist()` is requested only on an explicit export. Live path: post-run, deferred off the crash frame (implementer's measurements: 1.7-2.8 ms on the crash frame, 4-9 ms deferred), failures to `console.warn` and `registry['lastEvidenceStatus']`; the runtime ruleset is loaded from the committed artifact by a dynamic import of `runtimeRuleset.js` and re-hashed (browsers do not re-assemble it, because assembly reads source text).
- Manifest `sim.simRevision`, `tickHz`, `engine` are required and non-null whenever `rulesetId` is non-null (enforced by `resolveVerifier`: `malformed-manifest`).

**Section 7 (#166):** three tripwire attestation categories (`no-behavior-change`, `sim-revision-bumped` which must really bump `SIM_REVISION`, `behavior-change-unreleased` valid only while `SIM_REVISION > LAST_RELEASED_SIM_REVISION`, which is **0 today**; set it in the PR that releases a ruleset); the tripwire covers 28 files including `RunScene.js`. `resolveVerifier` results and refusal reasons (`unknown-ruleset`, `historical-verifier-required`, `malformed-manifest`, `malformed-ruleset-id`, `null-ruleset-not-legacy`, `ruleset-field-mismatch`); outcome records reject unknown keys (including a boolean `verified`); scoreboard helpers (`scoreboardKey`, `partitionByRuleset`, `crossRulesetView`, `RulesetMixError`). Known limits stated: in-function literals are invisible to the id; the two-version proof uses a toy simulation (the live sim reads module globals).

**Section 0.3 / Appendix:** new finding C12 for Team B (#140/#160), not a Team A fix: a mid-run palette toggle calls `refreshPalette`, which re-adds every joined terrain chunk (re-creating its Matter colliders), a user action that is not on the tape; whether it changes the trajectory is UNVERIFIED, and the `matter`/`terrain` fingerprints would show it. Appendix B is split into "b51ab36" and "after #164"; 8.2b adds an implementation-output manifest (real ruleset, production schema versions): `manifestDigest sha256:8dbf9239eae6f8990d380a08700b3409516d29e91b78a26d5fc05906cc44f718`.

#### Open items (not changes)

R-1 should resolve the daily rule through the ruleset table, not the live `DailyPatch.RULES` (equivalent at `SIM_REVISION` 1); `lastEvidenceStatus` has no UI consumer yet; no terminal capture at the crash tick; mapping a validation `inconclusive` onto the 7.4 verification outcomes is unspecified; the committed #164 manifest fixture still uses the synthetic ruleset and all-1 schema versions; C12 and the `blindMs`/`warned` classification await #140/#155.

#### Not verified here

Real-browser behavior and the evidence-path timings (implementer's numbers); SpiderMonkey/JavaScriptCore behavior of `Number::toString` and `Math.*` (Node/V8 only); whether C12 changes the trajectory; completeness of `NON_CAUSAL` beyond what the reflection tests prove; Team B's PRs (#159-#162) and #158 are still starter stubs, so alignment is by scope only.

### v1.0 (2026-11-21)

- **v1.0 (2026-11-21):** initial publication; incorporates the independent review. Changes relative to the pre-review draft: section 2 rewritten (explicit escapes, full error-code list, parse precedence, JSON Pointer locations, depth/size/string limits, cross-realm plain-object rule, no `TextEncoder`); `endTick`/terminal tick and claims re-derivation defined; `bb-pad` v1 fully specified (mask `0xFFFFF`, heli 3 refused, 1-based ticks, `dt` semantics, held pad, edge-only-on-tick); new conflict C11 and `causal.input.edgeRows`; bundle `exact.sled` as `F64`; per-subsystem `causal.checkpoints.schemas` map; `causal.bsod.leftEdgeX` and the BSOD formula; kodiak module omitted (not defaulted) in legacy mapping; `loadout.magnetsDrop` nullable for legacy; extra cross-field checks and `"none"` rule handling; R-4/R-5; field lists in 6.3 marked PROVISIONAL with stable-now list; sort rules and several shapes defined; ruleset `tables.*` projection, hidden literals and engine block; privacy additions; terminology (verifier / reference verifier / evidence); Appendix B.
