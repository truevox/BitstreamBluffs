# Replay Contract v1 reference vectors

Checked-in, hand-reviewed vectors for Replay Contract v1 (`docs/replay/replay-contract-v1.md`, section 8).

- `cjson-valid.json`: BB-CJSON v1 serialization vectors (`cj-*`): `input`, canonical `text`, UTF-8 `hex`, `sha256`.
  JS-only inputs are `{"$js": "<name>"}` descriptors resolved by `tests/replay/replayFixtures.js` (a fixed table, no
  eval). Anything invisible or non-ASCII (U+007F, U+2028, U+0301, ...) is written as explicit `\u` escapes in the
  descriptor and its `hex` is authoritative; such vectors omit the `text` copy.
- `cjson-reject.json`: rejection vectors (`rj-*`) with the contract `code` and RFC 6901 JSON Pointer `pointer`
  (`pointerHex` = UTF-8 hex of the pointer when it is not ASCII). `via: "canonicalize"` inputs are JS descriptors;
  `via: "parse"` inputs are bytes (`inputHex`, authoritative, with a readable `input` copy when it is printable ASCII)
  handed to `parseCanonical`. The amendment vectors rj-027..rj-043 pin error precedence and pointer escaping.
- `index.json`: every shipped vector id, by file (checked against the files by the tests).
- `hash-vectors.json`: SHA-256 (NIST FIPS 180-4 plus block-boundary patterns), XXH32 / xxh32x2, and F64 hex vectors.
- `fingerprint-vectors.json`: BB-FP v1 schemas, synthetic subsystem states (f64 fields as `f64:` hex strings), encoded
  bytes, `xxh32x2` digests, the combined digest, and the BSOD-only 1-ulp mutation (spec 6.10).

The files are canonical BB-CJSON bytes (no trailing newline) and are verified by the tests as such. They were produced
once by an independent scratch reference implementation plus `node:crypto`, not by the code under test. They are
**never auto-regenerated**: a test that rewrites them is forbidden, and changing a committed vector is a breaking
change to the contract (section 9). Edit them only deliberately, in a reviewed change that says why.
