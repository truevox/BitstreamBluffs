# Replay Contract v1 reference vectors

Checked-in, hand-reviewed vectors for Replay Contract v1 (`docs/replay/replay-contract-v1.md`, section 8).

- `cjson-valid.json`: BB-CJSON v1 serialization vectors (`cj-*`): `input`, canonical `text`, UTF-8 `hex`, `sha256`.
  JS-only inputs are `{"$js": "<name>"}` descriptors resolved by `tests/replay/replayFixtures.js` (a fixed table, no eval).
- `cjson-reject.json`: rejection vectors (`rj-*`) with the contract `code` and `$`-rooted `path`. `via: "canonicalize"`
  inputs are JS descriptors; `via: "parse"` inputs are canonical-JSON text handed to `parseCanonical`.
- `hash-vectors.json`: SHA-256 (NIST FIPS 180-4 plus block-boundary patterns), XXH32 / xxh32x2, and F64 hex vectors.
- `fingerprint-vectors.json`: BB-FP v1 schemas, synthetic subsystem states (f64 fields as `f64:` hex strings), encoded
  bytes, `xxh32x2` digests, the combined digest, and the BSOD-only 1-ulp mutation (spec 6.10).

The files are canonical BB-CJSON bytes (no trailing newline) and are verified by the tests as such. They were produced
once by an independent scratch reference implementation plus `node:crypto`, not by the code under test. They are
**never auto-regenerated**: a test that rewrites them is forbidden, and changing a committed vector is a breaking
change to the contract (section 9). Edit them only deliberately, in a reviewed change that says why.
