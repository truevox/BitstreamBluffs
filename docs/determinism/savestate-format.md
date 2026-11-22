# Production savestate envelope V1 — foundation only (#119 / PR #227)

**Status: implemented as an inert, pure format/validation library. No live savestate feature exists.** Nothing here captures or restores Matter/RunScene state, writes to storage, changes gameplay, grants leaderboard eligibility or authenticates a run. The shipped library registers **zero production layouts**, so a random or diagnostic snapshot cannot be accidentally treated as restorable by default. A successful inspector result means only `admission: 'envelope-only'`.

## Owner-approved product contract (preserved, not implemented by this PR)

- **Single-use suspend/resume:** the snapshot carries the GhostRecorder prefix from tick zero. The run may remain eligible for normal leaderboards only if the verifier replays the *complete input tape* from the beginning; the snapshot never substitutes for proof. The saved slot is atomically consumed before the resumed tick.
- **Heavy Mode/practice:** saves and reloads may be repeated, but a reloaded run is tagged tool-assisted and excluded from normal competitive boards.
- **Exact-build binding:** same game version alone is insufficient; a hash-like `buildId`, ruleset ID and simulation revision, bundled Matter version, and schema layout ID must all match. V1 refuses old versions; no migration or legacy physics runtime. A robust runtime `buildId` generator does not ship in PR #227, and callers **must supply it**. Copying browser storage to retry a consumed suspend remains an explicitly accepted prelaunch risk.

## Build identity source (#238)

`buildId` is now produced deterministically from artifacts the repository already commits, in `src/systems/savestate/buildIdentity.js`. Its closure is `gameVersion` (`package.json`), `physicsIdentity` (`tools/ruleset/current.json`), `matterVersion` (the archived ruleset's `engine.matter`), `savestateLayoutId` (the declared schema in `layoutDeclaration.js`), and a digest-of-digests over the causal-source tripwire (`tools/ruleset/source-digest.json`). Any missing or malformed part throws a coded `BuildIdentityError`; nothing is hashed by default. The running build reports it read-only via `src/systems/savestate/runtimeIdentity.js` (`loadCurrentBuildIdentity()`), and CI proves the committed artifacts with `node tools/ruleset/build-ruleset.mjs --check-identity`. Because the tripwire is in the closure, a patch-version bump or any causal-file change yields a different `buildId`; a docs-only change does not. This is still not a live savestate or a trust claim.


## Format

```
{
  "kind": "bb-savestate-cache",
  "version": 1,
  "purpose": "suspend" | "practice",
  "build": {
    "gameVersion": "2.19.18", "buildId": "sha256:<64 lowercase hex>",
    "physicsIdentity": { "rulesetId": "sha256:<64 lowercase hex>", "simRevision": 6 },
    "matterVersion": "0.20.0", "savestateLayoutId": "sha256:<64 lowercase hex>"
  },
  "runId": "local-run-123", "tick": 420,
  "payload": { "sections": { "<registered section>": "<schema-validated value>" } },
  "integrity": "sha256:<canonical unsigned envelope>"
}
```

Both encoder and inspector reuse **BB-CJSON v1** (`canonicalBytes`, `parseCanonical`) and the project's independent SHA-256 implementation. `snapshotEnvelopeBytes(unsigned)` computes integrity over the *entire unsigned header and payload*, not just the payload. It is **error detection**, not tamper-proof authentication. No untrusted snapshot supplies executable code, a validator or its own runtime identity.

The inspector is `inspectSnapshotEnvelope(bytes, expectedIdentity, registeredLayout)`. It returns `{ok:true, admission:'envelope-only', envelope}` or `{ok:false,code,pointer}`. The exact expected identity comes from the **caller**; without it the parser fails closed. A registered layout is `{descriptor,validateSections}` coming from **trusted shipped code**, not the byte stream. `savestateLayoutIdOf(descriptor)` hashes a versioned *declarative schema*, never a state value. No default runtime registration exists until the explicit per-class schemas and Matter adapter are independently reviewed.

Failures include `unsupported-format-version`, `missing-runtime-identity`, `missing-field`, `unknown-envelope-field`, `invalid-field`, `digest-mismatch`, `build-mismatch`, `physics-mismatch`, `matter-mismatch`, `layout-mismatch`, `unsupported-layout` and `invalid-section`. BB-CJSON error codes cover malformed UTF-8, duplicate keys, unsafe JSON numbers, proto keys, sparse arrays, overly deep or large documents and noncanonical encodings. Byte limit: the inherited canonical parser's 16 MiB maximum; the layout descriptor itself is limited to 64 KiB. No truncation, retry-as-success or memory-only persistence fallback.

Simulation floating-point values must be described **per field** and encoded using the existing canonical `f64Encode`/`f64Decode` functions. Arbitrary normal JSON numbers must not carry `NaN`, infinity or negative zero. An F64 encoding is allowed only when the *registered section validator* permits it, and its semantics (e.g., infinity as an ETA sentinel but not a body coordinate) remain the responsibility of the future per-class schemas.

## Follow-on release gates

The first release slice provides no live wiring. A safe sequence is: deterministic runtime build stamp; explicit class/reference and world schemas; full Matter internals including ID/contact/order and stable-hazard telegraph; transactional isolated fresh-world restore; complete GhostRecorder prefix; sticky tool-assisted eligibility and storage; IndexedDB durable atomic suspend consumption; UI; finally contact/hazard/Kodiak/BSOD/browser differential tests at 30/60/120 Hz. Compare every causal state after restore and refuse any unclassified field. Diagnostic `game-state-kit.js` reflection/partial restore is research and **must not** be promoted directly.

Compatibility: a snapshot is **not** a replay manifest or a public verifier's state fingerprint. Historical physics archives are retained but not executed by this V1. No production savestate, cross-build resume, historical migration or Safari/iOS support is claimed.
