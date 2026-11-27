# #424 — candidate-file envelope bridge (not yet player Save/Resume)

**Owner intent:** a one-use local Suspend/Resume must retain full original
causal state and GhostRecorder tape; repeatable reload is explicitly
tool-assisted and not an ordinary human ranked run. No local bytes alone
authorize a public Verified result. This module does not change those rules.

**Engineering provenance:** Gal Friday source-only work, based on the
v2.25.19 internal eight-section candidate and v2.25.3 IndexedDB slot.
No assertion that Marvin approved an operational/public release.

## Exact boundary

- A reviewed **version 2 declarative layout ID** binds the eight typed
  candidate sections into the build identity. The old empty-layout build
  is deliberately not misidentified as this schema.
- The local trusted source wraps the bounded canonical candidate file in
  a SHA-256-sealed `bb-savestate-cache` envelope with `purpose:'suspend'`.
  Candidate's run/tick/build/ruleset/SIM fields must match that envelope
  and the current build before `LocalSuspendSlot.put` can mutate storage.
- Validator receives the immutable *full envelope*, not a detached set of
  fields. Re-sealing a mismatched inner run/tick/build/section is refused.
- `inspectCandidateSuspendEnvelope` returns **envelope-only**, preserving
  the existing slot contract. The inner digest is error detection, not
  player authenticity, human attestation, or public reward authorization.
- Existing atomic `LocalSuspendSlot` claim/consume/release unchanged:
  concurrent tabs cannot claim one slot, unknown/corrupt persisted states
  never get silently overwritten, no TTL-based recovery of abandoned claims.

## Out of scope / blocking

- The format validator is NOT the complete per-class Matter validator;
  `createCandidateStateCodec.prepare()` must still validate causality
  against a truly fresh isolated scene before any activation.
- No automatic claim release on arbitrary restore errors: late partial
  mutations must discard the candidate, never publish a half-restored scene.
- No player Save/Resume button, scene handoff, actual PWA tab lifecycle,
  non-stock/modified configurations or independent official scoring.
- Actual Chromium page reload/slot consume, quota/denied storage, crash
  recovery and physical Chromebook proof remain required by #424 and #119.
  No network service, credential, evidence upload or Shard change.

[skip netlify]
