# Replay Contract v1 (Team A design, for #152)

Status: **DESIGN PROPOSAL, no product code.** Author: CC Friday (Team A). Baseline: `origin/main` @ `b51ab36` (2026-11-21).
Audience: Team B (simulation behavior, browser/cross-engine conformance) and Team A implementers of #116/#118/#123. Nothing here changes physics.

Length note: ~78 KB, over GitHub's 65,536-character comment limit. Post as 3 comments, split before section 4 and before section 8 (sections are self-contained); commit the full file as `docs/replay/replay-contract-v1.md` and link it.

Conventions: **VERIFIED** = read in code or executed at `b51ab36`. **UNVERIFIED** = inferred, or depends on something not inspected. "MUST/SHOULD" are normative for contract v1. Vectors quoted below were computed by a scratch reference implementation (Node 22); they become authoritative only when committed as fixtures (section 8).

---

## 0. Status, identifiers, alignment

### 0.1 Identifiers

| Thing | Issue | Draft PR | Owner |
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

### 0.2 What I could and could not read

- Issues #152/#116/#117/#118/#123 and PR bodies #158-#166: read via `gh` (authenticated). **All eight PRs (#158-#166) contain only a `.friday/issue-N-start.md` starter file.** There is no Team B code, no #158 fixture format. I could therefore only compare against their stated scopes and plans, not their implementations. #158's "fixture format" does not exist yet; section 8.4 proposes the envelope so #117 can adopt it rather than invent one.
- GBrain background pages read (`versioned-replay-verification` and its child review). Their code table was at `91dc728`; I re-verified against `b51ab36`.

### 0.3 Verified conflicts with current code (things this contract has to work around or fix)

| # | Finding at `b51ab36` | Effect | Handling |
|---|---|---|---|
| C1 | `RunScene.create` (L196): `daily = seedDayInfo ? {rule} : DailyPatch.getDailyInfo()`. A non-`daily-YYYY-MM-DD` seed plays **today's UTC daily rule** (8-rule rotation, modifiers change gravity, friction, air control). `_ghostHeader` records `dailyRuleId` but nothing reads `replay.dailyRuleId`. | A normal-seed tape replayed on a different UTC day uses a different physics rule. Violates #116 acceptance "same tape reproduces across different wall-clock dates". | Manifest records the rule; **R-1** below requires replay to honor it. |
| C2 | `new BsodPursuit({ level: prof.level … })` reads the **live profile Sync Level**. Header has no level; replay does not override it. Level changes `wallX` (head start `900*log1p(level-1)`) and BSOD acceleration. | Same tape, different profile level, different BSOD wall. Violates "reproduces across profile upgrades". | Manifest records `syncLevel` plus the resolved initial BSOD state as check values; **R-2**. |
| C3 | Replay fallback: `replay.kodiaksOn` absent -> `kodiaksEnabledFor({level: prof.level})`. `magnetsDrop` same. Tapes recorded before Kodiaks (or before `magnetsDrop`) replay with **live** profile choice. `GHOST_PHYSICS_VERSION` stayed 1 across the Kodiak merge, and `tapeCompatible()` checks only format/version/tickHz/physicsVersion/`trace` (not `runRandomVersion`, not `kodiakVersion`). | Old tapes can silently replay with bears on. | Legacy mapping (section 5): absent Kodiak fields mean `enabled:false`; absent `magnetsDrop` means field unknown, strict verification refused. **R-3**. |
| C4 | `quantizeTilt(-0)` returns `-0` (VERIFIED by executing it); `encodePad` stores `[0,-0]`; `rec.input` dedupes with `===` so `-0` is stored only when a bit change coincides. `JSON.stringify` writes `-0` as `0`; IndexedDB structured clone keeps `-0`. | Live run used `-0` tilt; a replay from an exported/JSON tape uses `+0`. Impact on physics: UNVERIFIED (probably only zero-sign of results, but it is a free divergence source). | Normalize at record time (`tilt127 === 0 ? 0`), and in evidence projection (section 4.5). Legacy comparisons treat `±0` as equal. |
| C5 | `docs/issue-56-ghost-library.md` specs checkpoints with a 32-bit checksum and header fields `generatorVersion`, `actionSchemaVersion`, and `CourseKey` with `gen<N>`. **None exist in code.** | Spec drift; do not rely on the doc. | Contract supersedes the doc for evidence. |
| C6 | Header `startedAt` (ms wall clock), `runId = ${startedAt}-${seed}`, tape `endedAt`; `cause` always `'crash'` in tapes. | Privacy (section 1.3); `cause` not informative. | Manifest excludes them; claims carry `cause` from the record. |
| C7 | `Rng.js` `utf8Bytes` encodes a **lone surrogate as a 3-byte sequence**, not U+FFFD. Seeds are user-typed. | A seed with a lone surrogate hashes differently in any independent implementation and cannot be represented in canonical JSON. | v1: such seeds are **evidence-ineligible** (run plays; no manifest is produced). UI may sanitize later. |
| C8 | `GhostLibrary._collect` deletes a tape immediately when no role references it. | Evidence cannot live there. | Separate store (section 1.2). |
| C9 | `lastElapsed` in Matter `engine.timing` is `Common.now()` (wall clock). | Must never enter a fingerprint. | Explicit exclusion (section 6.3). |
| C10 | `Sled` body geometry/density, trick factors, many magic numbers are literals inside functions, not exported constants. | A constants-only `rulesetId` cannot see them. | `SIM_REVISION` + canaries + source tripwire (section 7). |

**Required replay-resolution behavior (R-1..R-3).** These change what `RunScene.create` does **only when `_replayTape` is set**; live play is unchanged. Decision (Team A, v1.0): replay fidelity is #116 acceptance, so **Team A implements R-1..R-3 in #164**, confined to the replay-setup branch of `create()`. This is replay input resolution, not a simulation-behavior change; Team B's live-play behavior and the `update()` loop are untouched.
- R-1: when replaying, resolve the daily rule from the manifest `dailyRuleId` (looked up in the **ruleset's** rule table), never from the clock.
- R-2: when replaying, `prof.level` MUST NOT be read; use `manifest.causal.bsod.syncLevel`.
- R-3: when replaying, every `kodiaksOn`/`kodiakPackMode`/`magnetsDrop` comes from the manifest. No manifest value means refuse (strict) or documented legacy default (section 5).

### 0.4 Team B alignment (summary; details in 6.9 and Appendix A)

No hard incompatibility with the Team B drafts exists today. Two adjacency risks, both avoidable: (a) #162 edits `RunScene.update`'s pad-generation lines (~L1218-1221) and `SimClock.padsFor`; our fingerprint hook therefore lives **inside `GhostRecorder.afterTick`** (already called at L1230) and adds zero lines to `update()`. (b) #160 may make "minimal fixes in `src/**`" in RunScene; our only RunScene edit is `_ghostHeader` (~L498-515).

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
| Keyed by | `runId` | `bundleDigest` (content address); `runId`/course key live only in a local index |
| Purpose | draw ghosts | re-verify, diagnose, export, submit |

Rules:
- Separation by database makes `_collect` unable to affect evidence by construction (a pin flag inside `tapes` would depend on every future GC path being correct).
- IndexedDB is **not permanent**: browser clearing, quota pressure, private windows and device loss destroy it. The store MUST surface write failures to the user (no silent loss), SHOULD request `navigator.storage.persist()`, and MUST provide export/import of the canonical bundle bytes (`.bbreplay`) with its digest.
- Evidence stays local unless the player exports or explicitly submits it. No automatic upload. Bazaar sharing (#58) is a separate explicit action with its own policy.
- Evidence size is **estimated, not measured**: ~4 KB of inputs per 3 minutes (docs/issue-56 estimate, UNVERIFIED) plus checkpoints: `combined`-only ~26 B/checkpoint (~4.7 KB per 3 min); `full` detail ~250 B/checkpoint (~45 KB per 3 min). Default policy: `combined`; canaries and bug-report exports use `full` (section 6.7).
- Public (server-side) evidence retention, redaction and append-only event logs are future work (#135) and out of scope.

### 1.3 Privacy: existing header fields

| Field (`_ghostHeader` / tape) | Concern | v1 manifest treatment |
|---|---|---|
| `startedAt`, `endedAt`, `runId` (embeds `startedAt` + `seed`) | Millisecond wall-clock "when did this person play"; behavioral timing | **Excluded.** Evidence is addressed by digest. A local index may keep `runId`; it is not exported by default. |
| `seed` | Required for replay. User-typed seeds can contain a name, handle or email | Included (causal). Export UI MUST show the seed before exporting. Cannot be redacted without changing the run. |
| `controlLayout` | Device-habit signal; not causal (the effect is already in `variableHop`/`noAutoNudge` input bits) | **Excluded** |
| `upgradeRanks`, `boosts`, new `syncLevel` | Reveal account progress | Included (causal); consent copy on export |
| Browser UA, OS, hardware | Fingerprinting | **Never** written to a manifest. Conformance harnesses record environment in their own result files. |
| `initials` (RunRecord) | PII-ish | Never in manifests or tapes (already not in tapes) |

A manifest contains no account, email, device or network identifier. Lone-surrogate seeds: see C7.

---

## 2. Canonical serialization: BB-CJSON v1

Goal: the **same bytes in every implementation**, so a SHA-256 over them is a stable identity. BB-CJSON v1 is a strict profile of RFC 8785 (JCS) with extra rejections. A value that is not representable is an **error, never silently altered**.

### 2.1 Rules

| Topic | Rule | Why |
|---|---|---|
| Encoding | UTF-8, no BOM, no trailing newline | |
| Whitespace | None anywhere | |
| Value types | `null`, `true`, `false`, string, number, array, plain object | |
| Rejected | `undefined` (anywhere, including array elements and object values), functions, symbols, BigInt, `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`, class instances (prototype must be `Object.prototype` or `null`), accessor properties, symbol keys, sparse arrays, arrays with extra properties | `JSON.stringify` silently drops/changes these; silent change = identity bug. Absent is not `null`: builders omit absent optional keys explicitly. |
| Object keys | Sorted by **UTF-16 code unit** order (JS default `Array.prototype.sort` on strings). Duplicate keys are impossible on output and **rejected on parse**. | JCS-compatible; JS's native order. |
| Key alphabet | v1 restricts every key to `^[A-Za-z0-9_.:$-]{1,64}$` and rejects `__proto__` | With ASCII-only keys, UTF-16 order = code point order = UTF-8 byte order, so ports to Rust/Go/Python cannot disagree on ordering (which is the only place the choice matters). Values may be any well-formed Unicode. |
| Strings | Escape exactly: `"`->`\"`, `\`->`\\`, U+0008/09/0A/0C/0D -> `\b \t \n \f \r`, other U+0000-U+001F -> `\u00xx` (**lowercase** hex). Everything else literal UTF-8, including U+007F, U+2028/2029, `/`. No other `\u` escapes. Lone surrogate => error. **No Unicode normalization**: `"é"` (U+00E9) and `"é"` (e+U+0301) stay different. | Seeds are identity; normalizing would change terrain. |
| Integers | Safe integers only (`Number.isSafeInteger`), decimal, no `+`, no leading zeros, no exponent. Integer-valued floats (`3.0`, `1e3`) are integers. **`-0` is an error.** | |
| Non-integer numbers | Finite; output is ECMAScript `Number::toString` (shortest round-trip digits; ES2015+ normative); **rejected if the output contains `e`** (i.e. outside `1e-6 <= abs(x) < 1e21`). `NaN`, `±Infinity`: error. | RFC 8785's number rule, narrowed to the exponent-free band where non-JS implementations most often disagree. Decimal text is for **authored constants** (ruleset, `1.15`); see 2.2 for physics state. |
| Arrays | Order preserved | |
| Depth | Container nesting **<= 32** | Parser safety |
| Size | Output <= 16 MiB; string <= 1 MiB | |
| Binary payloads | Never as typed arrays. By schema: standard base64 (RFC 4648, `=` padded) strings; decoders re-encode and reject non-canonical forms. Digests: lowercase hex. | Matches the existing `trace` encoding (`btoa`). |

### 2.2 Floats that carry physics state: `F64` hex, by schema

The serializer is generic; **schemas** decide where a float is an `F64`: the string `"f64:" + 16 lowercase hex digits` = IEEE-754 binary64 bits, **big-endian**. Use `F64` for every number that (a) comes out of the simulation (start pose, resolved BSOD state, checkpoints) or (b) is derived from arithmetic (e.g. `1.15 / (1 + log1p(...)*0.17)`). `-0`, `±Infinity` are legal in `F64`; `NaN` encodes as `f64:7ff8000000000000` and is flagged by validators as a warning. Plain decimals are allowed only for **authored constants** (ruleset), where the authored shortest literal is the identity.

Decision rationale: relying on `Number::toString` for authored constants is acceptable (spec-defined shortest, cross-engine; RFC 8785 has years of conformance); relying on it for *computed* physics state would mix "same bits" with "same text" and hide -0/NaN. Hex is exact, trivially portable, and makes `-0` visible. Cost: ~22 bytes vs ~18 for a decimal.

Every implementation MUST run the vector self-test (section 8) at verifier start; an engine whose `Number::toString` differs fails loudly. VERIFIED: all current constant tables (`PHYSICS`, `SCORING`, `TERRAIN`, `GLITCH`, `TUNING`, `BSOD_DEFAULTS`, `DailyPatch.RULES`, `BOOST_DEFS`, `UPGRADE_CATALOG`, exported numeric consts of TerrainGenerator/HazardMotion/Kodiaks) and all 72 `src/data/{chunks,hazards,powerups,terrainMods,biomes}/*.json` files **serialize under these rules unchanged**, with no exponent-notation floats in `TUNING`. Node 22/V8 only; SpiderMonkey/JSC conformance is UNVERIFIED (to be shown by #120).

### 2.3 Canonical on-disk form and parsing

Stored and transmitted evidence is **always canonical bytes**. A reader MUST: decode UTF-8 strictly -> parse with a **duplicate-key-rejecting** parser (plain `JSON.parse` keeps the last duplicate, so two implementations can disagree) -> re-serialize -> require **byte equality** with the input (`not-canonical` otherwise). Digests are taken over the received bytes after this check. Parsed objects SHOULD use `Object.create(null)` to defuse `__proto__`.

### 2.4 Worked examples (reference implementation output)

| id | Input (JS) | Canonical text | SHA-256 |
|---|---|---|---|
| cj-001 | `{}` | `{}` | `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` |
| cj-003 | `{b:1,a:2,B:3,_:4,'10':5,'9':6,aa:7,'a.b':8,'a-b':9}` | `{"10":5,"9":6,"B":3,"_":4,"a":2,"a-b":9,"a.b":8,"aa":7,"b":1}` | `sha256:e6ca48648a0463b55454e7ef751468c42bc6357832a26c78a0db9982434386db` |
| cj-004 | `{z:[3,1,2],a:{y:null,x:true,w:false}}` | `{"a":{"w":false,"x":true,"y":null},"z":[3,1,2]}` | `sha256:2247629f1fbd78153e4d67314eaf96ac6bf9d3918d86213913bc63f5311ca241` |
| cj-006 | `[0,-1,1,9007199254740991,-9007199254740991,120,127,-127]` | same, no spaces | `sha256:49acf9cd778604f49c457c71d156f2e85ad982f30b9b2353f90f0c0d3104ea77` |
| cj-007 | `[0.1, 0.30000000000000004, 1.15, 0.15, 0.000001, 123456.789, 0.5, -2.5, 1.7, 4.35, 0.0003, 0.1+0.7]` | `[0.1,0.30000000000000004,1.15,0.15,0.000001,123456.789,0.5,-2.5,1.7,4.35,0.0003,0.7999999999999999]` | `sha256:b40cfdcf5bb391ea237f17b3a3e6bfd09fbf0de2acb28fc1988f8d7ffa4b3a61` |
| cj-008 | `[3.0, 1e3, 2**40]` | `[3,1000,1099511627776]` | `sha256:0e21d11d6b971007875ff6093fd4e835710b9a9ccfcd7d8bc41a9e6ea0796693` |
| cj-009 | `{nfc:'é', nfd:'é'}` | `{"nfc":"é","nfd":"é"}` (bytes `c3a9` vs `65cc81`; not normalized) | `sha256:79eae438d105e852f86ea598ffdda91643386fad0b4f336b941528d30fbf1558` |
| cj-010 | `{pose:[f64(1.5), f64(-0), f64(0.1), f64(-Infinity)]}` | `{"pose":["f64:3ff8000000000000","f64:8000000000000000","f64:3fb999999999999a","f64:fff0000000000000"]}` | `sha256:c37670da2ffc1fa4642b5927c2e8f17bfbe6bc05cf4150f45f15f3c2e65c457d` |
| cj-005 | `{s:'q"b\\c/\n\t\r\b\f\u0001\u001f\u007f é😀'}` | UTF-8 bytes `7b2273223a22715c22625c5c632f5c6e5c745c725c625c665c75303030315c75303031667fe280a8c3a9f09f9880227d` (note: `\u001f` escaped lowercase, U+007F and U+2028 **literal**) | `sha256:56ca796abf915839f5114c542afa62a9de53124df711ef47c4df51641b42ec70` |

`F64` helper vectors: `0 -> f64:0000000000000000`, `-0 -> f64:8000000000000000`, `1 -> f64:3ff0000000000000`, `1.5 -> f64:3ff8000000000000`, `0.1 -> f64:3fb999999999999a`, `4.35 -> f64:4011666666666666`, `Infinity -> f64:7ff0000000000000`, `-Infinity -> f64:fff0000000000000`, `NaN -> f64:7ff8000000000000`, `5e-324 -> f64:0000000000000001`.

**Required rejections** (each MUST fail with the named code; the error path is `$`-rooted): `NaN` (`nan`), `Infinity` (`infinity`), `-0` (`negative-zero`, also nested), `9007199254740992` (`unsafe-integer`), `1e-7` (`float-out-of-range`), `1e21` (`unsafe-integer`), `{a:undefined}` and `[undefined]` (`undefined`), lone surrogate (`lone-surrogate`), key `é` (`key-not-allowed`), key `__proto__` (`proto-key`), `Date`/`Map`/typed array/class instance (`non-plain-object`), `1n` (`unsupported-type:bigint`), `[1,,3]` (`sparse-array`), 33 nested arrays (`too-deep`; 32 is accepted). Parse-level rejections: `{"a":1,"a":2}` (`duplicate-key`); `{ "a": 1 }`, `{"b":1,"a":2}`, `{"a":1}\n`, `{"a":"\/"}`, `{"a":1e2}`, `{"a":"A"}` (all `not-canonical`). Error *codes* are part of the contract so that cross-implementation tests can assert them.

---

## 3. Two hash tiers

### 3.1 Tier A: identity digests

- Format: `sha256:` + 64 lowercase hex. Algorithm prefix is mandatory; an unknown prefix means **refuse** (never "treat as opaque").
- Input: the canonical bytes (section 2) exactly as stored, so `sha256sum file.bbcj` reproduces it. No extra domain-separation prefix; every hashed document carries its own `format` field *inside* the bytes, which makes cross-type confusion a schema error.
- Where used: `rulesetId`, `manifestDigest`, `causalDigest`, `tapeDigest`, `bundleDigest`, evidence store keys, canary fixture ids.
- Implementation: ship a small **synchronous pure-JS SHA-256** as the reference, optionally accelerated by `crypto.subtle`, with both checked against the vectors at start. Reasons: (a) `crypto.subtle` exists only in secure contexts (an `http://192.168.x.x` dev page has none; UNVERIFIED for deployed origins), (b) Jest's `jsdom` environment does not provide it (jest.setup.js defines no crypto), (c) sync code removes async plumbing. Cost is irrelevant: inputs are tens of KB and hashed outside the sim loop. Tests may cross-check with `node:crypto`.
- Vectors: `sha256("")=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, `sha256("abc")=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` (NIST).

### 3.2 Tier B: frame fingerprints

- Format: `xxh32x2:` + 16 lowercase hex = `hex8(XXH32(bytes, 0x00000000)) + hex8(XXH32(bytes, 0x9E3779B9))`.
- Input: the **BB-FP binary encoding** (section 6.5) of one subsystem's causal state (not JSON text; no allocation of strings in the sim loop).
- Algorithm choice: reuse XXH32 because it is already in the repo, spec-compliant and tested, and has reference implementations in every language (reference vectors: `XXH32("",0)=02cc5d05`, `("a",0)=550d7456`, `("abc",0)=32d153ff`, `("Nobody inspects the spammish repetition",0)=e2293b2f`; and `("abc",0x9e3779b9)=1bab3a57`, `bytes 00..0f -> b72837f4`, `xxh32x2(bytes 00..1f)=830741c1698ff899`). Two seeds give 64 bits. VERIFIED: a bytes-based XXH32 gives identical output to the repo's `xxHash32(string)` on ASCII/UTF-8 inputs, including `seed != 0`; the existing string function stays untouched (ledger hashes depend on it).
- Collision tradeoff: for two *different* states that differ by honest nondeterminism (not an attacker), the chance of a matching 64-bit digest is ~2^-64 per comparison: negligible against ~1000 checkpoints x 13 subsystems per run. A 32-bit digest would be ~2^-32 per comparison (~10^-7 over a few thousand), enough in practice but needlessly thin when it costs one extra pass. XXH32 is **not** resistant to adversarial collisions at all (seed is public); that is acceptable only because fingerprints never certify anything.
- A fingerprint MUST NOT be described, logged, displayed or stored as "secure", "signed", "proof", "anti-cheat" or "verified run".
- Existing ledger hashes V1-V4 remain xxHash32 over `JSON.stringify([...])` arrays (not BB-CJSON); they are referenced, never rewritten (section 5.4).

---

## 4. Replay Manifest schema v1 (#116)

### 4.1 Envelope and tiers

```
{ "format":"bb-replay-manifest", "formatVersion":1, "formatMinor":0, "critical":[],
  "causal":{ ... }, "info":{ ... }, "ext":{ ... } }
```
- **`causal`**: everything that can change the simulated trajectory. Digested separately as `causalDigest = sha256(canonical(causal))`: two runs with the same `causalDigest` and same tape digest MUST produce the same fingerprints under the same verifier.
- **`info`**: informational/classification; never needed to replay; included in `manifestDigest` only.
- **`ext`**: extension namespace (key alphabet as 2.1). Not part of `causal`.
- `manifestDigest = sha256(canonical(whole manifest))`, stored **outside** the manifest (in the evidence bundle/index), never inside it.

### 4.2 Unknown-field and compatibility policy (fail closed)

1. Unknown top-level key (outside `format, formatVersion, formatMinor, critical, causal, info, ext`) => **refuse** (`unknown-envelope-field`). Envelope shape changes bump `formatVersion`.
2. Unknown key inside `causal` (any depth) => **refuse** (`unknown-causal-field`). Reason: an unknown causal input means this reader cannot reproduce the run; trusting would be silent miscalculation.
3. Unknown key inside `info` => **preserve byte-for-byte on re-serialization and ignore**.
4. `ext` entries: unknown and not listed in `critical` => preserve and ignore. Listed in `critical` (array of `ext` keys; sorted, unique) and not understood => **refuse** (`unsupported-critical-extension`). A `critical` entry naming a nonexistent `ext` key => refuse.
5. `formatVersion` greater than the reader's => refuse (`unsupported-format-version`). `formatMinor` greater than the reader's: allowed **only** if the reader's rules 1-4 hold (minors may add `info` keys, `ext` keys, and *new causal modules the reader refuses by rule 2*). A new causal module therefore reaches old verifiers as a refusal, never as silent ignorance.
6. Missing required field, wrong type, out-of-range value, non-canonical bytes, `F64` malformed => refuse with a path (`invalid-field: causal.bsod.syncLevel`).
7. Absence of an *optional* causal module has a defined meaning stated in the table (e.g. no `kodiak` module = bears off); readers MUST NOT apply live-profile defaults.
8. Cross-field consistency checks MUST run: `causal.sim.tickHz == causal.input.tickHz == ruleset tickHz`; `info.lane.mode == 'daily'` implies empty ranks/boosts, `kodiak.enabled=false`, `magnetsDrop=true`; `causal.rng.physicsScramble == xxHash32('physics/scramble', xxHash32(seed))` (derivation check); `bsod.initial` equals the value recomputed from the ruleset + `syncLevel` + ranks (catches `BsodPursuit` constructor drift). A failed consistency check is a refusal, not a mismatch.

### 4.3 Field table

Kinds: **C** causal, **K** classification (lane/eligibility, not trajectory), **I** informational. Source = where the value comes from today. `F64` = section 2.2.

| Path | Type | Req | Kind | Source / notes |
|---|---|---|---|---|
| `format` | `"bb-replay-manifest"` | R | | |
| `formatVersion` | int `1` | R | | |
| `formatMinor` | int >= 0 | R | | `0` for this document |
| `critical` | sorted string[] | R | | may be `[]` |
| `causal.sim.rulesetId` | `sha256:`str \| null | R | C | section 7. `null` only if `info.provenance="legacy-derived"` |
| `causal.sim.simRevision` | int >= 1 \| null | R | C | consistency copy of the ruleset's; `null` only if legacy |
| `causal.sim.tickHz` | int | R | C | `SIM_TICK_HZ`=120 |
| `causal.sim.engine` | `{phaser,matter}` strings \| null | R | C | consistency copy (`3.90.0`, `0.20.0`); ruleset is authoritative |
| `causal.course.seed` | string, well-formed | R | C | `RunScene.seed`; exact |
| `causal.course.biomeMask` | uint32 | R | C | `RunScene.biomeMask` |
| `causal.course.dailyRuleId` | string \| null | R | C | `RunScene.dailyRuleId` (**C1**) |
| `causal.course.dailyRuleSource` | `"seed-date"` \| `"clock-at-start"` \| `"recorded"` | R | C | how it was chosen at recording; informative for audits |
| `causal.loadout.upgradeRanks` | `{id: int>=1}` active only | R | C | `upgradeRun.ranks` (`{}` when none) |
| `causal.loadout.boosts` | sorted string[] | R | C | `appliedBoosts` |
| `causal.loadout.magnetsDrop` | bool | R | C | `magnetsDrop` |
| `causal.kodiak` | `{enabled,packMode,version}` | O | C | absent = bears off. `packMode` in `same|mixed`; `version` = `KODIAK_VERSION` (2) |
| `causal.bsod.syncLevel` | int >= 1 \| null | R | C | `prof.level` (**C2**); `null` only if legacy |
| `causal.bsod.initial` | `{wallX,wallSpeedPxS,accelerationPxS2}` F64 \| null | R | C | derived check values, from a freshly constructed `BsodPursuit` |
| `causal.start.tick` | int, must be `0` in v1 | R | C | non-zero is reserved (mid-run segments); refuse |
| `causal.start.pose` | F64[6] `[x,y,angle,vx,vy,angVel]` | R | C | sled body after spawn, boosts, Gym excluded |
| `causal.rng.version` | int | R | C | `RUN_RANDOM_VERSION` |
| `causal.rng.physicsScramble` | uint32 | R | C | initial state; only causal stream (VERIFIED: `visual*` streams never feed the sim) |
| `causal.input.protocol` | `"bb-pad"` | R | C | input protocol id (4.4) |
| `causal.input.protocolVersion` | int | R | C | `1` = tape v1 |
| `causal.input.tickHz` | int | R | C | |
| `causal.input.tiltScale` | int `127` | R | C | |
| `causal.input.bits` | `{bool[],edge[],heliShift}` | R | C | self-description of the bit layout: bool fields in bit order (`push, variableHop, noAutoNudge, divebomb, corkscrew, tuck, brakeHeld, hop, reset, airBrake, parachute, pause`), edge fields next (`hop, reset, pause, airBrake, parachute, confirm`), `heliShift` 18 (2 bits: 0 none, 1 = +1, 2 = -1). MUST equal what the protocol version defines |
| `causal.input.endTick` | int >= 0 | R | C | last tick whose input exists |
| `causal.input.tapeDigest` | `sha256:` | R | C | 4.5 |
| `causal.checkpoints.everyTicks` | int | R | C | 120 |
| `causal.checkpoints.algo` | `"xxh32x2"` \| null | R | C | null only if `detail="none"` (legacy) |
| `causal.checkpoints.schemaVersion` | int \| null | R | C | `bb-fp` version |
| `causal.checkpoints.detail` | `none|combined|full` | R | C | how checkpoints are stored in the bundle |
| `info.gameVersion` | string | O | I | `package.json` version, informational |
| `info.provenance` | `live-recording` \| `legacy-derived` \| `synthetic` | R | I | selects guarantees (section 5) |
| `info.lane` | `{mode, dailyOfficial, dailyMode, draft?}` | O | K | `mode` in `normal|daily|daily-draft` (`gym` is never evidence-eligible); `draft = {rulesVersion,budget}` |
| `info.inputCapture.edgeAssignment` | string | O | I | recorder-side policy, e.g. `frame-first-tick` (today) or `timestamp-window` (#115). Never needed to replay |
| `info.rngVisual` | `{visualSled,visualFx,visualCamera}` uint32 | O | I | presentation streams, restart from seed |
| `info.legacy` | object | O | I | only for legacy-derived (section 5) |
| `ext` | object | R | | `{}` allowed |

Timers: all gameplay timers (cooldowns, slow-mo, effects, Head Start opening) start from fixed values that the code derives from the loadout and the ruleset table, so v1 stores **no timer values**; they are covered by the fingerprints from tick 120 on and by the derivation checks above. UNVERIFIED that no timer is initialized from a clock; the C-ledger in 6.2 asserts none is.

Not in the manifest (and why): `startedAt`/`endedAt`/`runId`/`controlLayout`/UA/initials (privacy, 1.3); `distanceM`/`score`/`cause` (claims, in the bundle); the pose trace (regenerable); derived static tables (ruleset); Matter-internal values (not an input).

### 4.4 Input protocol versioning (for #115 and future tape formats)

- The tape's meaning is defined by `(causal.input.protocol, protocolVersion)`, **not** by `GHOST_TAPE_VERSION` alone. Protocol `bb-pad` v1 = the current `[tickDelta, bits, tilt127]` rows, 120 Hz, bit layout above. `GHOST_TAPE_VERSION` 1 maps to `bb-pad` 1.
- **Pad bits are append-only.** A new input field takes the next free bit and bumps `protocolVersion`; a v1 reader refuses any row whose bits exceed the v1 mask (`0x3FFFFF`, bits 0-21) rather than ignore them.
- **A v1 tape stays verifiable forever:** each protocol version's `decodePad` is retained as part of the verifier artifact for the corresponding `simRevision`; a verifier selects the decoder by `(protocol, protocolVersion)` and refuses (`unsupported-input-protocol`) if it lacks one. New versions add decoders, they never alter old ones.
- #115 (timestamp -> tick window) changes **how a recorder assigns key events to ticks** (`SimClock.padsFor`), not what a tape row means; tapes it produces remain `bb-pad` v1 and replay identically. That is why `info.inputCapture.edgeAssignment` is informational: it lets analyses separate tapes recorded under the old policy (edge on the first tick of a frame) from the new one, without affecting replay. Only if #115 needs to *add* a recorded quantity (for example a sub-tick offset or held-edge bit) does `bb-pad` become v2. In that case Team B announces it in #152, the next `formatMinor`/`simRevision` bumps are coordinated, and a `bb-pad` v1 decoder is kept.
- A replay does not use `SimClock` at all (`TapePlayer.padAt(tick)`); `SimClock.accMs/droppedMs/_edges` are scheduling state and are **not causal**. Only `SimClock.tick` is.

### 4.5 Tape content digest and the evidence bundle

`tapeDigest = sha256(canonical({"format":"bb-input-tape","formatVersion":1,"protocol":{"id":"bb-pad","version":1},"tickHz":120,"endTick":N,"inputs":[[dt,bits,tilt127],...]}))`. Row integers are normalized: `v === 0 ? 0 : v` (kills `-0`, C4). Cosmetic `trace`, `startedAt`, checkpoints are **not** in this digest, so regenerating or stripping the trace never changes identity. (Example from the scratch tape: inputs `[[1,7,0],[199,6,0],[50,4230,0],[1,134,0],[19,6,0],[31,6,127],[39,6,0]]`, `endTick 600` -> `sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23`.)

Evidence bundle `bb-replay-evidence` v1 (one canonical file; stored/exported/submitted as a unit):

```
{ "format":"bb-replay-evidence","formatVersion":1,
  "manifest":{...}, "manifestDigest":"sha256:...",
  "inputs":[[dt,bits,tilt127],...],              // must hash to manifest.causal.input.tapeDigest
  "checkpoints":[[120,"<combined16hex>"], ...],  // detail=combined; detail=full: [tick, combined, s1..s13] in FP_SUBSYSTEMS order
  "exact":{"sled":[[120,x,y,a,vx,vy,w,score],...]}, // optional; legacy numeric checkpoints carried over
  "claims":{"endTick":N,"cause":"crash","score":S,"distanceM":D} }
```
`bundleDigest = sha256(canonical(bundle))` is the store key. Claims are *assertions to be re-derived*, not facts. v1 has no terminal fingerprint (see 6.6).

---

## 5. Legacy compatibility

### 5.1 Principle

Existing `bb-ghost-tape` v1 tapes are **not migrated or rewritten**. A "legacy-derived manifest" is *computed on demand* from the tape header, marked `info.provenance:"legacy-derived"`, and carries **reduced guarantees**. Nothing is written back to IndexedDB, the ledger, or `SaveStore`; v1 requires no data migration.

### 5.2 Mapping

| Tape header (`_ghostHeader`+recorder) | Legacy-derived manifest | Note |
|---|---|---|
| `seed`, `biomeMask` | `causal.course.*` | exact |
| `dailyRuleId` | `causal.course.dailyRuleId`, source `"recorded"` | recorded since #56, **ignored by current replay (C1)** |
| `boosts`, `upgradeRanks` (null -> `{}`), `magnetsDrop` | `causal.loadout.*` | `magnetsDrop` absent => not derivable: strict verification refused (C3) |
| `kodiaksOn`/`kodiakPackMode`/`kodiakVersion` | `causal.kodiak` | **all three absent => `{enabled:false}`** (tape predates Kodiaks); partially present => refuse |
| `startPose` | `causal.start.pose` (F64) | exact |
| `random.physicsScramble`, `runRandomVersion` | `causal.rng` | exact; `visual*` -> `info.rngVisual` |
| `simTickHz`, `version`, `endTick`, `inputs` | `causal.input.*` | `protocolVersion` = tape `version` |
| `physicsVersion` | `info.legacy.physicsVersion` | not a ruleset |
| *(none)* | `causal.sim.rulesetId = null`, `simRevision = null`, `engine = null` | not recorded |
| *(none)* | `causal.bsod.syncLevel = null`, `initial = null` | **not recorded (C2)** |
| checkpoints (exact sled, 7 numbers/120 ticks) | `causal.checkpoints.detail="none"`; numbers carried in bundle `exact.sled` | |
| `startedAt`, `endedAt`, `runId`, `controlLayout`, `trace` | dropped from the manifest | privacy / regenerable |
| `format`, `version`, `physicsVersion`, count of checkpoints | `info.legacy` | |

### 5.3 Reduced guarantees and outcomes

A legacy-derived manifest can only be checked by a verifier that **declares its own ruleset** (`verifiedUnder: <rulesetId>`). Outcomes:
- all exact sled checkpoints match (numeric `==`, so `+0 == -0`) and `endTick` matches: `consistent-with` (never `verified`);
- a checkpoint mismatch: `inconclusive-legacy` (the tape may simply predate a behavior change, C1/C2/C3 and unrecorded Sync Level); never `refuted`;
- legacy outcomes MUST NOT be eligible for any scoreboard keyed by `rulesetId` (section 7.5).
Tapes whose run never involved BSOD aerodynamics or the wall catch will usually be indifferent to the unknown Sync Level; that is an observation, not a guarantee.

### 5.4 Run ledger V1-V4

- `RunRecord`s and `computeLedgerHashV1..V4` are **not touched**, not rehashed, not extended. `sanitizeRun` keeps dropping unknown keys and never recomputes `ledgerHash`.
- The link record -> evidence is by local index (`runId` -> `bundleDigest`) in the evidence database, not a record field (a new record field would need a V5 hash; that decision is deferred, Q7).
- A manifest never embeds a ledger hash and the ledger never embeds a bundle digest in v1.

---

## 6. Authoritative causal state and fingerprints (#118)

### 6.1 Definitions

*Causal state* at tick T is everything that, together with inputs for ticks > T and the ruleset, determines the future. The contract does **not** require it to be *restorable* (savestate is #119); it requires it to be **complete enough that a divergence in any causal variable changes some subsystem fingerprint no later than the next checkpoint**. Presentation state (camera, Fx, HUD, audio, particles, `visual*` RNG, Glitch director) is excluded and tested for non-influence (6.9, #140).

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

### 6.3 Subsystem catalog (v1 baseline)

13 subsystems, fixed order `FP_SUBSYSTEMS = [clock, rng, sled, matter, terrain, hazards, pickups, effects, bsod, kodiak, score, tricks, recovery]`. Field lists are the **baseline derived by reading `b51ab36`**; UNVERIFIED for completeness. The #165 PR MUST finalize them with the completeness test in 6.8 and amend this table (allowed until the first fingerprint fixture is committed to `main`; afterwards per-subsystem `schemaVersion` bumps). Encoding types in 6.5. "Owner" = the code whose behavior defines the fields (field changes there require a list update).

| Subsystem | Fields (in order) | Owner |
|---|---|---|
| `clock` | `tick:u32` (`SimClock.tick`), `runTimeMs:f64` (accumulated `+=dt`; deterministic float sum), `crashed:bool`. **Excluded:** `SimClock.accMs/droppedMs/_edges` (scheduling), `_hudMs`, `_frameDt` | RunScene, SimClock |
| `rng` | `version:u32`, `physicsScramble:u32` (`runRandom.physicsScramble.state`). Only causal RNG stream; per-bear streams are in `kodiak`. **Excluded:** `visualSled/Fx/Camera`, `GlitchDirector.rng`, `CosmeticRandom` | RunRandom |
| `sled` | root body: `x,y` (position), `px,py` (positionPrev), `angle`, `anglePrev`, `vx,vy`, `angVel`, `fx,fy`, `torque`, `posImpX,posImpY`, `conImpX,conImpY,conImpAngle`, `deltaTime` (all f64), `totalContacts:i32`, `isSleeping:bool`; `parts: list<{x,y,px,py,angle,anglePrev}>` (5); controller f64: `msSinceContact, groundAngleDeg, airtimeMs, hopBufferMs, playerHopElapsedMs, pushCooldownMs, parachuteMs, parachuteFuelMs, canopyFuelFullMs, heliPhase, heliVel, invulnerableMs, boostMs, geyserCooldownMs, airEtaMs (may be +Infinity), dropAheadDeg, groundRunMs, sinceLaunchMs, landSettleMs, crawlMs, lastTilt, preVx, preVy`; `opt<f64>`: `airSlopeDeg, touchdownVx, touchdownVy`; `heliInput:i32`; bool: `contactFlag, playerHopActive, chuteUsed, tucked, airBrakeActive, corkscrewActive, shield, scrambled, nudging`; `lastPadBits:u32, lastPadTilt127:i32` (from `_lastPad`). `heliPhase` is causal because the trick tracker scores it (docs/issue-59: it moved into `Sled.stepHeli` for that reason). **Excluded:** `squash`, `pose`, `hidden`, `gfx`, `look`, `hopPulse/pushPulse` (cleared each tick) | `entities/Sled.js` |
| `matter` | `timestamp:f64`; `bodies`: every **non-static, non-sled** body in detector order -> `{label:str, sensor:bool, same f64 body fields as sled root}`; `staticOrder: list<{label:str, minX:f64, minY:f64}>` (static colliders in detector order); `pairs: list<{aLabel,bLabel:str, aMinX,bMinX:f64, active:bool, separation:f64, contacts: list<{normalImpulse:f64, tangentImpulse:f64}>}>` in `pairs.list` order. **Excluded:** absolute ids, `lastElapsed`, `metrics`, `lastUpdatesPerFrame`, `Common._nextId` (diagnostic dump only) | Phaser Matter, `PhysicsTuner.stepWorld` |
| `terrain` | `seedState:u32` (`terrain.seedState`), `joined: list<i32>` sorted chunk indices that are **physical** (`mesh.chunks`), `queue: list<i32>` sorted (`_chunkQueue`), `chunkDigests: list<str>` (`xxh32x2` of each joined chunk's immutable points+spawn lists, memoized per index so cost is amortized). `biomeMask:u32` | TerrainGenerator, RunScene.streamTerrain |
| `hazards` | for each joined chunk (ascending), each hazard in chunk order: `defId:str, hit:bool, destroyed:bool, open:bool, rolling:bool, phase:f64, roll:{activeAtMs:opt<f64>, offsetPx, vPxS, simMs, simDist, simV :f64}` (`HazardMotion.RollState`). Mover body pose is in `matter.bodies`. **Not included (presentation):** `warned`, `alert`, `_lastDraw`, `spin`, telegraph tracker (see 6.9, #155) | Hazard.js, HazardMotion.js |
| `pickups` | `collectedPowerups: list<str>` (sorted), `shardCollected: list<str>` (sorted), `activeZones: list<str>` (sorted keys). Live powerup/shard entities are a pure function of `terrain.joined` + these sets | RunScene, ShardField |
| `effects` | f64: `slowMs, slowFactor, scrambleMs, boostMs, boostFactor, slowmoMs, slowmoScale, hitStopMs, blinkMs, resetCooldownMs, glideMs, glideMul, stabilizeMs, stabilizeDeg, stabilizeBounce, magnetMs`; `shieldCharges:i32`, `openingGraces:i32`, `shieldSources:list<str>`, `wards:list<{id:str, msLeft:f64}>` (UNVERIFIED shape; `Wards.js`), `magnetEff` (opt record), Head Start opening is derived from `loadout` (not stored). `blindMs/blindVis` classified presentation (overlay only), UNVERIFIED | RunScene, Wards, BiomeEffects |
| `bsod` | `active:bool, wallX, wallSpeedPxS, accelerationPxS2:f64, caught:bool`; bluff tracker: `armed, usedCanopy, usedAirbrake:bool, closestGapPx, previousGapPx: opt<f64>, chain:u32, lastAwardX, lastAwardTimeMs: f64` (may be `-Infinity`). `bsodState` snapshots are derived and excluded | BsodPursuit, BsodBluffTracker |
| `kodiak` | `next:u32` (`kodiakNext`), `on:bool`, `bears: list<{kind:str, n:u32, member:u32, x:f64, speed:f64, phase:str, phaseMs:f64, ageMs:f64, rngState:u32, feints:u32, targetX:opt<f64>, groundY:f64 (NaN allowed), sledAhead:bool, real:opt<bool>, hit:bool, done:bool}>`. Bears are kinematic with no Matter body (VERIFIED), so this is their entire state | Kodiaks.js, RunScene.updateKodiaks |
| `score` | `ScoreManager`: `distanceM, trickPoints, penaltyPoints, bonusPoints, bestCombo, flow, flowRemainingMs, bestFlow:f64`; `pending:f64`; `lastMilestoneSector:i32`; `bonusCounts{shard,nearMiss,milestone}`, `bonusByKind{...}`: i32/f64 triples; `comboTricks:list<str>`; `paid` and `counts` as sorted `list<{k:str,v:f64}>`. RunScene: `shardChain, shardChainAt, shardTotal, shardCount, nearMissCount, maxAirtimeMs, bestCombo, lastTotal`; `trickCounts` sorted map | ScoreManager, RunScene |
| `tricks` | `TrickTracker`: `_air:bool, _airStart:f64, _tiltNet, _heliNet, _tiltDone, _heliDone, _corkscrewNet, _corkscrewDone, _brakeMs, _chuteMs, _heliMax, _prevAngle: f64; _brakeDone, _chuteDone, _heliHeld, _havePrev: bool; _prevHeli: opt<f64>`; RunScene `_airTricks, _landings, _steepMs` | TrickTracker, RunScene |
| `recovery` | `pendingCrash: opt<{cause:str, hazardId:opt<str>}>`, `crashTimerMs:f64`, `safeSamples: list<{...}>` (shape UNVERIFIED; they drive `manualReset` respawn so they are causal), `safeTimer:f64` | RunScene |

Where a field above is flagged UNVERIFIED, the #165 PR's completeness test (6.8) is the arbiter. Every `f64` field is encoded bit-exactly (including `-0`, `±Infinity`).

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

`combined` input: `u32 fpVersion(=1) | u32 tick | u32 count | count x 8 raw digest bytes` in `FP_SUBSYSTEMS` order; digest = `xxh32x2`. All digests present or `throw` (a missing subsystem is a bug, never a silent zero).

### 6.6 Interface and cadence

```
// src/systems/replay/fingerprint*.js  (pure; no Phaser import)
FP_VERSION = 1;  FP_SUBSYSTEMS = Object.freeze([...13 names...]);  FP_SCHEMAS = { name: { version, schema } }
captureCausalState(sceneLike)  -> CausalState = { fp: 1, tick: int, <subsystem>: plain object, ... }   // reads, never mutates
fingerprintState(state)        -> { fp: 1, tick, combined: "xxh32x2:...", subsystems: { clock: "xxh32x2:...", ... } }
dumpState(state, opts?)        -> flat { "bsod.wallX": "f64:...", "kodiak.bears[0].phase": "approach", ... }  // sorted paths, F64 for floats
compareRuns(a, b, opts?)       -> CompareResult
```
`sceneLike` is a duck type (what `GhostRecorder.afterTick(tick, scene)` already receives), so capture is testable without Phaser. `captureCausalState` allocates; it runs only at checkpoint ticks or in explicit diagnostic windows, never per tick in production.

**Cadence.** Production: after `simTick` on every tick with `tick % 120 === 0` while not crashed, i.e. exactly where `GhostRecorder.afterTick` records the sled checkpoint today. **No new RunScene `update()` lines**: the hook is `GhostRecorder.afterTick` (or an observer it calls). **Terminal record:** v1 has none beyond `claims.endTick/cause/score/distanceM` (the crash tick is not passed to `afterTick`: `if (!this.crashed)` guards it). A verifier that wants the terminal state captures it in its own harness. Diagnostic: per-tick capture inside an explicit window `[a,b]` (tools only, off in production).

**`compareRuns(a, b)`** where each side is a `RunTrace = { manifestDigest, checkpoints: [{tick, combined, subsystems?}], dumpAt?(tick): Promise<state> }`:
1. Refuse if `causalDigest`s differ (`causal-mismatch`) unless `opts.ignoreCausal`.
2. Find the first checkpoint tick `t1` with different `combined` (also detect different lengths/`endTick`).
3. Name the differing subsystems at `t1` (needs `full` detail on both sides, else obtained by re-simulating the side that has no detail).
4. **Localize the tick:** re-simulate both runs once from tick 0 with a *per-tick capture window* `(t0, t1]` where `t0` is the previous matching checkpoint; compare per-tick `combined`; the first mismatch is `firstDivergentTick`. (This is equivalent to bisection but needs one re-sim per side rather than `log2(120)` re-sims, because capture does not perturb timing. Without savestates (#119) every probe must restart from tick 0; if a future runner has savestates, bisection from `t0` is the cheaper alternative.)
5. `dumpAt(firstDivergentTick)` on both; diff the flat dumps; report the first differing path in canonical sorted order and all differing paths in that subsystem.

```
CompareResult = { status: "match" | "diverged" | "inconclusive",
  firstDivergentTick, firstDivergentCheckpoint, subsystem, fieldPath, expected, actual,
  differingSubsystems:[...], matchingSubsystems:[...], resims:int, note? }
```
Example (the BSOD-only mutation): `{"status":"diverged","firstDivergentTick":97,"firstDivergentCheckpoint":120,"subsystem":"bsod","fieldPath":"bsod.wallX","expected":"f64:c0bd2fecccccccce","actual":"f64:c0bd2feccccccccf","differingSubsystems":["bsod"],"matchingSubsystems":["clock","rng","sled","matter","terrain","hazards","pickups","effects","kodiak","score","tricks","recovery"],"resims":2}` (tick `97` illustrative).

### 6.7 Checkpoint storage detail

`combined` (default in the archive): `[tick, combined]` per checkpoint, detects drift but cannot attribute it without a second source. `full`: `[tick, combined, s1..s13]`; attributes the subsystem without re-simulation on the recording machine. Canaries and conformance reports SHOULD use `full`. A verifier that has the tape can always regenerate per-subsystem digests on its own side; it needs the other side's `full` only to attribute without access to the original machine.

### 6.8 Completeness enforcement (anti-drift)

A reflection test per owner class: every own enumerable property of `Sled`, `ScoreManager`, `TrickTracker`, `BsodPursuit`, `BsodBluffTracker`, `Hazard` (non-visual), a Kodiak bear, and the RunScene field list appears in exactly one of `{schema field, NON_CAUSAL allowlist with a reason}`. Adding a property to those classes without classifying it fails CI. This is what makes the table above correct over time; it is not left to review attention. Scoped lint for `Math.random`, `Date.now`, `performance.now` in causal modules is a separate gate (Gate C in #152; `Date.now()` in `RunScene` for ids/timestamps is legitimate).

### 6.9 Team B interfaces and what they can rely on

- **#161 (cross-engine matrix, main consumer).** Compare `FingerprintResult.subsystems` per checkpoint across engines (digests are over IEEE bits, so any `Math.*` difference shows as a changed digest in the owning subsystem), then localize with the window scan and report `dumpState` field paths. Report rows: `{env, fixtureId, rulesetId, result: CompareResult}` where `env` is **the harness's own record** (engine/version/OS/arch/Hz/session index). A cheap addition Team B may make (not required by us): a `mathProbe` digest of fixed `Math.sin/cos/atan2/pow/tanh/log1p/hypot/sqrt` inputs per engine, to name suspect operations for #121. Until #165 lands, Team B's tool-local digests are fine; to be *comparable later*, adopt the subsystem names and the BB-FP layouts in 6.3/6.5 now. The names are stable, the encodings are specified here independent of our code.
- **#160 (presentation isolation).** Their per-tick digest can be replaced by `fingerprintState` with the same subsystem names. The contract makes their matrix a first-class test: for a fixed tape, fingerprints at every checkpoint MUST be identical across presentation perturbations (render cadence 30/60/120/144, viewport, zoom/shake, audio on/off, extra draws from `visual*` streams). Any difference is a **bug in the sim/presentation boundary**, not a schema issue. `updateGroundTelegraph` using `this._view.right` (#155): the contract classifies `warned`/telegraph state as *presentation* (not hashed). If #160/#155 shows it feeds causal state, that is a leak to fix and the field must then be added to the schema (subsystem schema bump).
- **#159 (savestate).** Our `sled`/`matter` field lists are the *fingerprint* baseline and are a **subset by design** of what a restorable snapshot needs (a restorable snapshot additionally needs full per-body vertices/bounds/inertia, constraint and composite structure, `Common._nextId`, the pair table including identity). Names and field ownership above are intended to be reused verbatim for the shared parts. When #159 finds a hidden variable that affects the future, it should be added through #152 change control (a subsystem schema bump), so fingerprints and savestates share one inventory. Savestate digests stay diagnostic (their PR says so too).
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

`rulesetId = sha256(canonical(ruleset))` where the **ruleset document** (`bb-ruleset` v1) is:

```
{ format, formatVersion, simRevision,                       // simRevision: hand-bumped int >= 1
  versions:{ ghostPhysics, ghostTapeFormat, runRandom, kodiak, draftRules, tickHz, inputProtocol:{id,version} },
  engine:{ phaser, matter, positionIterations, velocityIterations, gravityYPerKilo, maxPhysicsStepMs },
  constants:{ physics, scoring, terrain, tuning, bsodDefaults, terrainGenerator, hazardMotion, kodiak, pixelsPerMeter },
  tables:{ dailyRules, boostDefs, upgradeCatalog, draft:{budget,rulesVersion} },
  content:{ chunks, hazards, powerups, terrainMods, biomes }  // each keyed by id, causal projection }
```
Assembly rules (so independent builders get the same bytes):
- Sources: `constants.js` (`PHYSICS`, `SCORING`, `TERRAIN`, `PIXELS_PER_METER`, `MAX_PHYSICS_STEP_MS`), `PhysicsTuner.TUNING`, `BsodPursuit.BSOD_DEFAULTS`, **every exported numeric constant or numeric array** of `TerrainGenerator`, `HazardMotion`, `Kodiaks` (collected by an explicit registry, sorted by name; a new numeric export that is not registered fails the registry test), `DailyPatch.RULES`, `BOOST_DEFS`, `UPGRADE_CATALOG`, `DRAFT_BUDGET`/`DRAFT_RULES_VERSION`, version constants, `package-lock` resolved versions of `phaser` (3.90.0) and bundled Matter (0.20.0), the Matter engine setup (`positionIterations 8`, `velocityIterations 6`; `constraintIterations` default 2 is UNVERIFIED and must be read from the live engine in the registry test).
- `content.*` = the JSON under `src/data/{chunks,hazards,powerups,terrainMods,biomes}` **minus an explicit cosmetic denylist** (`name, lore, background, palettes, unlockLevel`). **Default is include**: a forgotten causal key is a silent catastrophic miss; a forgotten cosmetic key is a loud spurious ID change that gets fixed by adding one denylist entry.
- Not included: audio, UI strings, achievements, missions, cosmetics, palettes, progression table (Sync Level thresholds are not sim; only the *resulting level* is, via the manifest).
- Illustrative value (computed by the scratch assembler at `b51ab36`, 22,936 canonical bytes, `simRevision` 1): `sha256:620f89827d62221300906f36d5284e6cacb2767911eaf4a22eb3a4ce13e6de3c`. **Not normative**: #166 publishes the real value and fixture; this number only lets a second implementation sanity-check the assembly.

### 7.2 `SIM_REVISION`, drift, and what constants cannot see

A rulesetId built from constants misses behavior changes made in code (C10: Sled geometry/density, contact logic, trick/landing rules, update order, Matter patching). So:
1. `SIM_REVISION` (hand-bumped integer in `src/systems/replay/ruleset*.js`) is part of the document. **Bump it in the same PR as any change to causal code behavior**, even a bug fix, even with no constant touched.
2. Backstops: (a) golden canaries (#117) fail on unbumped drift because exact checkpoints change; (b) an optional **source tripwire**: `tools/ruleset/source-digest.json` holds SHA-256 of an allowlisted list of causal source files; CI fails when it changes unless the PR also updates it with a one-line "no behavior change" or "SIM_REVISION bumped" attestation. The tripwire digest is **not** part of `rulesetId` (a refactor should not change identity) and is not a proof; it forces a human decision.
3. `SIM_REVISION` is independent of `package.json` version and of `GHOST_PHYSICS_VERSION`. The latter is kept for legacy mapping only and is not bumped further.

### 7.3 Verifying under a different rulesetId

A verifier holds a set of rulesets `R` (and possibly frozen verifier artifacts, 7.5). For a manifest with `rulesetId = X`:

| Situation | Outcome |
|---|---|
| `X` in `R` and active verifier is the one for `X` | run; outcomes `match` / `diverged` |
| `X` not in `R` | **`refused: unknown-ruleset`** (never "try the current one") |
| `X` in `R` but its ruleset requires an older verifier implementation than the current one | **`refused: historical-verifier-required`** naming the verifier artifact digest |
| `X == null` (legacy) | section 5.3, `consistent-with`/`inconclusive-legacy` only |
| Mismatch with current ruleset but historical verifier exists | verify under the historical one; result labelled with that ruleset |

A mismatch is never auto-repaired by reinterpreting old settings under the current ones.

### 7.4 Outcome record

`{ outcome, verifiedUnder: rulesetId, verifierId: <artifact digest or "in-game">, tapeDigest, manifestDigest, firstDivergence?: CompareResult }`. No boolean `verified`. A record is a statement by a named verifier.

### 7.5 Scoreboards and artifacts

- **Scoreboards MUST key on `rulesetId`** (plus lane/mode/`biomeMask`/seed as today). A board that spans multiple `rulesetId`s must say so in its type; mixing is never implicit. Legacy outcomes are not eligible. Historical validity and current eligibility are separate fields.
- Ruleset documents and manifests are small and archived by content hash (cheap, immutable). Executable verifier bundles are archived **only when code behavior diverges from what the current implementation can reproduce** (history of `SIM_REVISION` bumps); they are publisher-built, hash-allowlisted, never uploaded by players and **never executed from input**. Retention of the bytes is a promise; ability to *run* an old verifier (browser/OS/security) is a separate, weaker promise (Q4).
- Two-version proof for #123 acceptance: one current sim plus one deliberately altered `SIM_REVISION` (test-only constant tweak); the same tape verifies under both only against its own ruleset, and the current board never lists the old one.

---

## 8. Test fixtures and reference vectors

### 8.1 Location (matches the declared scopes of #163: `docs/replay/**`, `src/systems/replay/canonical*`, `tests/**/replay*`)

```
docs/replay/replay-contract-v1.md                 (this document, canonical copy)
tests/fixtures/replay/v1/README.md                (how vectors are regenerated; they are never auto-regenerated in CI)
tests/fixtures/replay/v1/cjson-valid.json         [{id, input, text, hex, sha256}]   (cj-001..011; JS-only inputs given as {"$js":"..."} descriptors)
tests/fixtures/replay/v1/cjson-reject.json        [{id, input, code, path?}]         (rj-001..026)
tests/fixtures/replay/v1/hash-vectors.json        sha256 (NIST), xxh32 and xxh32x2 vectors, F64 hex vectors
tests/fixtures/replay/v1/fingerprint-vectors.json BB-FP schemas, states, bytes, digests, combined, BSOD-only mutation
tests/fixtures/replay/v1/manifest-v1.example.json            canonical bytes + digests (8.2)
tests/fixtures/replay/v1/manifest-legacy.example.json        legacy-derived (8.3)
tests/fixtures/replay/v1/compare-divergence.example.json     CompareResult (6.6)
tests/replay/*.test.js                                       consume the above (Jest ESM)
```
Fixtures are **checked in as bytes** and verified by tests; a test that regenerates and overwrites them is forbidden. Changing a committed vector is a breaking change (section 9).

### 8.2 Manifest example (scratch tape, synthetic content)

Canonical bytes (1,612 B, single line): `manifestDigest = sha256:76c772de4053b4e46db27f44c196d0250077851f63e0a901e328fe0f6067f680`, `causalDigest = sha256:5a66c8f5a98f33770d830eaeb63f51c637618f12a13b11a3c7c92f6e097fb89f`. `rulesetId` is the illustrative value from 7.1. `dailyRuleId` is `featherweight` because 2026-11-21 UTC selects that rule (this is a normal seed, so the rule came from the clock: C1).

```json
{"causal":{"bsod":{"initial":{"accelerationPxS2":"f64:3ff2666666666666","wallSpeedPxS":"f64:405cc00000000000","wallX":"f64:c0bd868000000000"},"syncLevel":1},"checkpoints":{"algo":"xxh32x2","detail":"combined","everyTicks":120,"schemaVersion":1},"course":{"biomeMask":0,"dailyRuleId":"featherweight","dailyRuleSource":"clock-at-start","seed":"RPLAY59"},"input":{"bits":{"bool":["push","variableHop","noAutoNudge","divebomb","corkscrew","tuck","brakeHeld","hop","reset","airBrake","parachute","pause"],"edge":["hop","reset","pause","airBrake","parachute","confirm"],"heliShift":18},"endTick":600,"protocol":"bb-pad","protocolVersion":1,"tapeDigest":"sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23","tickHz":120,"tiltScale":127},"kodiak":{"enabled":false,"packMode":"same","version":2},"loadout":{"boosts":[],"magnetsDrop":false,"upgradeRanks":{}},"rng":{"physicsScramble":1037858759,"version":1},"sim":{"engine":{"matter":"0.20.0","phaser":"3.90.0"},"rulesetId":"sha256:620f89827d62221300906f36d5284e6cacb2767911eaf4a22eb3a4ce13e6de3c","simRevision":1,"tickHz":120},"start":{"pose":["f64:404dbfffffffffff","f64:c0203f35ba6e8dec","f64:3fbacee9f37bebd5","f64:3fe999999999999a","f64:3fb1eb851eb851ec","f64:0000000000000000"],"tick":0}},"critical":[],"ext":{},"format":"bb-replay-manifest","formatMinor":0,"formatVersion":1,"info":{"gameVersion":"2.15.1","inputCapture":{"edgeAssignment":"frame-first-tick"},"lane":{"dailyMode":"classic","dailyOfficial":false,"mode":"normal"},"provenance":"live-recording","rngVisual":{"visualCamera":699437410,"visualFx":2914981907,"visualSled":1630249723}}}
```

### 8.3 Legacy-derived example

From a real-format tape produced by the repo's `GhostRecorder` with the `b51ab36` header shape (`seed RPLAY59`, 600 ticks, kodiak fields present and `kodiaksOn:false`): `causal.sim = {rulesetId:null, simRevision:null, tickHz:120, engine:null}`, `causal.bsod = {syncLevel:null, initial:null}`, `causal.checkpoints = {algo:null, detail:"none", everyTicks:120, schemaVersion:null}`, `info.provenance="legacy-derived"`, `info.legacy = {format:"bb-ghost-tape", version:1, physicsVersion:1, exactSledCheckpoints:5, absentFields:[]}`. Canonical bytes 1,386 B, `sha256:374ea29329b304b29f46e595ae521438e78f56606316f78779897216c38d8554`:

```json
{"causal":{"bsod":{"initial":null,"syncLevel":null},"checkpoints":{"algo":null,"detail":"none","everyTicks":120,"schemaVersion":null},"course":{"biomeMask":0,"dailyRuleId":"featherweight","dailyRuleSource":"recorded","seed":"RPLAY59"},"input":{"bits":{"bool":["push","variableHop","noAutoNudge","divebomb","corkscrew","tuck","brakeHeld","hop","reset","airBrake","parachute","pause"],"edge":["hop","reset","pause","airBrake","parachute","confirm"],"heliShift":18},"endTick":600,"protocol":"bb-pad","protocolVersion":1,"tapeDigest":"sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23","tickHz":120,"tiltScale":127},"kodiak":{"enabled":false,"packMode":"same","version":2},"loadout":{"boosts":[],"magnetsDrop":false,"upgradeRanks":{}},"rng":{"physicsScramble":1037858759,"version":1},"sim":{"engine":null,"rulesetId":null,"simRevision":null,"tickHz":120},"start":{"pose":["f64:404dbfffffffffff","f64:c0203f35ba6e8dec","f64:3fbacee9f37bebd5","f64:3fe999999999999a","f64:3fb1eb851eb851ec","f64:0000000000000000"],"tick":0}},"critical":[],"ext":{},"format":"bb-replay-manifest","formatMinor":0,"formatVersion":1,"info":{"lane":{"mode":"normal"},"legacy":{"absentFields":[],"exactSledCheckpoints":5,"format":"bb-ghost-tape","physicsVersion":1,"version":1},"provenance":"legacy-derived","rngVisual":{"visualCamera":699437410,"visualFx":2914981907,"visualSled":1630249723}}}
```

 A second fixture removes `kodiaksOn/kodiakPackMode/kodiakVersion` and expects `kodiak.enabled=false`; a third removes `magnetsDrop` and expects refusal for strict verification (C3).

### 8.4 Canary fixture envelope (to be consumed by #117/#158, not duplicated)

#158 currently has no fixture format. Proposal so it needs none: a canary fixture is a `bb-replay-evidence` bundle (`detail:"full"`) plus `manifest.ext.canary = {id, covers:[...], expects:{...}}` (non-critical). `covers` is a list of behavior tags the harness must observe activating during the replay (rolling hazard active, BSOD catch, parachute+wind, flip landing...), so "scenario name only" is not enough. #158 can implement the harness first and adopt the envelope once #163 merges; a fixture that needs extra metadata uses `ext`, never a new top-level key. Canaries use `full` checkpoints so a divergence names its subsystem. Canary fixtures live in `tests/canaries/**` (#158's scope), not under `tests/fixtures/replay/v1/` (contract vectors).

### 8.5 Required tests (summary)

(1) every `cjson-valid` vector reproduces text/hex/SHA; every `cjson-reject` fails with the code; (2) pure-JS SHA-256 == `node:crypto` == vectors; (3) bytes-XXH32 == repo `xxHash32` on shared inputs; (4) fingerprint vectors incl. the BSOD-only mutation; (5) manifest validator: every unknown-field rule in 4.2, consistency checks, `critical` handling, non-canonical bytes; (6) `tapeDigest` ignores `trace`/`startedAt` and normalizes `-0`; (7) legacy mapping incl. absent Kodiak/`magnetsDrop`; (8) reflection completeness (6.8); (9) evidence store survives `GhostLibrary._collect` and a reload, and reports quota failure; (10) same tape replays under a faked clock on different days and different profile levels once R-1/R-2 land (acceptance for #116).

---

## 9. Change control

- **Where published:** every revision is a numbered comment in #152, titled `Replay Contract v1.N`, with a **changelog** and a link to the exact commit of `docs/replay/replay-contract-v1.md` and the fixtures. Team B reads #152; PR bodies link the contract version they implement. The version in the doc header is authoritative.
- **Non-breaking (v1.N, N+1):** new `info` fields; new `ext` keys; new optional error detail; new vectors; clarifications; **new subsystem fields before the first fingerprint fixture is merged**; additional canonical error codes; new `critical`-flagged extensions (old readers refuse them by design).
- **Breaking (needs v2.0 or a per-component version bump, a migration note, and a retained reader for the old version):** changing any serialization rule in section 2 or any committed vector; changing a hash input, seed, or encoding (BB-FP, `xxh32x2`); changing a required field's meaning; adding/removing/reordering a *causal* field or subsystem after the first fingerprint fixture exists (per-subsystem `schemaVersion` bump, old fixtures remain valid under old schema version); changing `bb-pad` bit layout (protocol version bump); changing `rulesetId` assembly rules (the documented sources/denylist); renumbering `FP_SUBSYSTEMS`; moving the evidence store.
- **Interfaces Team B can rely on (stable for v1):** BB-CJSON v1 and its error codes; `sha256:`/`xxh32x2:` formats; `bb-replay-manifest` v1 field paths and 4.2 policy; BB-FP encoding and subsystem names/order; `FP_*` constants; `captureCausalState/fingerprintState/dumpState/compareRuns` signatures and `CompareResult` shape; `bb-pad` v1; the evidence bundle shape; the rule that RunScene's `update()` loop is untouched by us. Anything not listed (internal helper names, file layout under `src/systems/replay/` beyond the file-name prefixes, the scratch reference code) can change.
- **Coordination rule:** a *sim behavior* change by Team B that adds causal state MUST update the field table/schema in the same PR (the reflection test forces it), bump `SIM_REVISION`, and announce in #152.

---

## 10. Open questions / owner decisions

1. ~~Who edits `RunScene.create` for R-1/R-2/R-3?~~ **Resolved v1.0:** Team A in #164, replay-setup branch only (section 0.3).
2. Retention window for **local** evidence: keep all until user deletes (proposed), cap by bytes with visible prompt, or by count? Default export format/location?
3. Official verifier: pinned headless Chromium running the real game vs portable math (#120/#121 evidence). This contract is neutral: it only makes divergence visible. A pinned Chromium verifier does not prove a Safari-recorded run matches it.
4. Support horizon for historical verifiers (time-limited execution vs indefinite archive-only), and who maintains security patches for pinned old browsers.
5. Seeds with lone surrogates: reject at input (sanitize), or keep "evidence-ineligible"?
6. Whether `combined` checkpoint detail is enough for the default local archive, or `full` should be default (4.7 KB vs ~45 KB per 3 minutes, estimated).
7. Bind ledger record -> evidence (new `RunRecord` field would need a V5 hash and a `sanitizeRun` whitelist; today it would be silently dropped) or keep the local index only?
8. Privacy/consent copy for exporting evidence (seed may contain PII; ranks/Sync Level reveal progress), and COPPA review before any upload (#135).
9. Terminal fingerprint at the crash tick: would need a hook outside `afterTick` (crash tick is not passed). Worth the extra RunScene line (hot file), or leave to harnesses?
10. `blindMs`, `warned`/telegraph state, `activeZones`/`wards` shapes: confirm presentation vs causal with #140/#155 results.

---

## 11. Implementation slicing

Principle: pure modules under a new `src/systems/replay/` (no Phaser, importable from Jest), thin hooks, and **no edits to the `update()` loop**. File-name prefixes follow the scopes already declared in the draft PRs.

### 11.1 #152 / PR #163: contract foundation (no product behavior)

| Path | Content |
|---|---|
| `docs/replay/replay-contract-v1.md` | this document |
| `src/systems/replay/canonicalJson.js` | `canonicalize`, `canonicalBytes`, `parseCanonical`, `CJSONError`, `f64Encode/f64Decode` |
| `src/systems/replay/canonicalSha256.js` | sync pure-JS SHA-256, `digestOf(value)`, optional `crypto.subtle` accelerator + boot self-test |
| `src/systems/replay/canonicalBinary.js` | `xxh32Bytes`, `xxh32x2`, `FpWriter` (BB-FP encoder), `combineFingerprints` |
| `tests/fixtures/replay/v1/*` , `tests/replay/canonical*.test.js` | vectors 8.1 and tests 8.5 (1)-(3), (6) |
| (not touched) | `Rng.js` `xxHash32` (existing string function stays byte-identical) |

### 11.2 #116 / PR #164: manifest

| Path | Content |
|---|---|
| `src/systems/replay/manifest.js` | `buildManifest(runContext)`, `validateManifest(bytes, rulesetResolver)` with 4.2 rules, `legacyManifestFromTape(tape)`, `evidenceBundle(...)` |
| `src/systems/replay/evidenceStore.js` | separate IndexedDB `bitstream-replay-evidence`, memory fallback, export/import, quota errors surfaced |
| `src/systems/ghost/GhostTape.js` | tiny edits: normalize `-0` in `quantizeTilt`/`encodePad`; `finish()` also exposes the header pieces the manifest needs |
| `src/scenes/RunScene.js` | **`_ghostHeader()` only (~L498-515):** add `syncLevel: prof.level` source, resolved BSOD initial values, `dailyRuleSource`; remove nothing. Optionally one line in `_saveGhostTape` handing the tape to the evidence store (outside the update loop) |
| `tests/replay/manifest*.test.js` | 8.5 (5), (7), (9), (10 after R-1/R-2) |

### 11.3 #118 / PR #165: fingerprints

| Path | Content |
|---|---|
| `src/systems/replay/fingerprintSchemas.js` | 13 schemas (6.3), `FP_SUBSYSTEMS`, `NON_CAUSAL` allowlists |
| `src/systems/replay/fingerprintCapture.js` | `captureCausalState(sceneLike)`, `dumpState` |
| `src/systems/replay/fingerprint.js` | `fingerprintState`, `compareRuns` |
| `src/systems/ghost/GhostTape.js` | `afterTick`: one added call at the existing `tick % CHECKPOINT_EVERY === 0` branch (plus `exact.sled` unchanged). **No `RunScene.js` change** |
| `tools/replay/fingerprint-dump.mjs` (or reuse Team B's harness) | diagnostic window runner for `compareRuns` |
| `tests/replay/fingerprint*.test.js` | vectors, BSOD-only mutation, reflection completeness (8.5 (4), (8)) |

### 11.4 #123 / PR #166: rulesets

| Path | Content |
|---|---|
| `src/systems/replay/ruleset.js` | `SIM_REVISION`, ruleset registry, `buildRuleset(content)`, `rulesetId`, denylist, `resolveVerifier(manifest)` outcomes (7.3) |
| `src/systems/replay/rulesetRegistry.js` | explicit list of numeric exports to include (new numeric export without registration fails) |
| `tools/ruleset/build-ruleset.mjs`, `tools/ruleset/source-digest.json` | committed ruleset JSON + digest; source tripwire (7.2) |
| `docs/replay/time-capsules.md` | archive policy, two-version proof |
| `tests/replay/ruleset*.test.js` | determinism of assembly, content denylist, unregistered export fails, two-version proof |

RunScene.js budget summary: **`_ghostHeader`, the replay-setup branch of `create()` (R-1..R-3, #164 only), optionally one line in `_saveGhostTape`**. No `update()` loop edits.

---

## Appendix A: Team B alignment matrix

| PR | Their scope | Our interaction | Incompatibility today |
|---|---|---|---|
| #159 (#119) | `docs/determinism/**`, `tools/savestate-experiment/**`, `tests/determinism/savestate-*`; no `src/` | Field inventory shared; ours is fingerprint subset; additions via #152 | None |
| #160 (#140) | `tools/conformance/**`, `tests/determinism/**`, `docs/determinism/**`; may fix proven leaks in `src/**` | Replace diagnostic digest with `fingerprintState`; presentation isolation is a contract test; `updateGroundTelegraph` leak left to #155 | Possible RunScene textual overlap only if they edit `_ghostHeader` (they should not) |
| #161 (#120) | `tools/conformance/cross-engine*`, fixtures, `docs/determinism/**` | Main consumer: per-subsystem digests, `compareRuns`, `dumpState`; recorded fixtures via `GhostRecorder` are legacy tapes today, use `legacyManifestFromTape` until #164 lands | None. Their Chromium-recorded tapes carry `-0` risk (C4) and no Sync Level (C2); legacy outcomes are `consistent-with` only |
| #162 (#115) | `InputRouter`, `VirtualPad`, `SimClock`, `RunPad`, **RunScene update input glue**, tests | v1 tape unchanged; capture policy recorded in `info.inputCapture`; protocol bump only if a new recorded quantity is needed | Adjacent lines to nothing we touch (our hook is in `GhostTape.js`). They explicitly do not touch the tape format |
| #158 (#117) | `tools/canaries/**`, `tests/canaries/**` | Adopt evidence-bundle envelope (8.4) | Fixture format not yet defined |
