# Expected differences (`expected/<id>.json`)

An **expected difference** is a reviewed statement that a canary is *supposed* to look different after a
deliberate handling change. It is the only way a real difference can avoid being reported `DIVERGED`, and it
is deliberately narrow: it never turns a canary green in general, it only covers the exact fields and
magnitudes a reviewer wrote down and signed.

**This directory ships with no approvals.** A file appears only after an independent reviewer has looked at
the actual diff and the actual records.

## Schema

```json
{
  "id": "flip-edge",
  "allowed": [
    { "field": "x", "maxAbs": 2 },
    { "field": "score", "maxAbs": 5 }
  ],
  "reason": "Landing tolerance narrowed: the sled now settles up to 2 px later at the same impact angle. Deliberate, see PR #NNN.",
  "reviewer": "Deep Think (read-only diff review)",
  "reviewedAt": "2026-11-21T18:00:00.000Z"
}
```

- `id` — must equal the canary id (the file name without `.json`); a mismatch is an error, never a wildcard.
- `allowed[].field` — a concrete comparison field. Checkpoint fields are `x`, `y`, `angle`, `vx`, `vy`,
  `score`; outcome fields are `crashed`, `crashTick`, `cause`, `score`, `distance`, `endTick`; the synthetic
  field `checkpointCount` covers a run that produced a different number of checkpoints.
- `allowed[].maxAbs` — a finite, non-negative number. `0` is legal and means "declared, but must not move".
  `"*"`, `null`, a string, or a negative value is rejected.
- `reason` — required prose. Say what changed mechanically, not "expected".
- `reviewer` — required. Name the independent reviewer that saw the records. Self-approval by the author of
  the change does not satisfy this.
- `reviewedAt` — required ISO-8601 timestamp of the review.

## How it is honoured (fail-closed)

For one canary, `tools/canaries/lib/compare.cjs#classifyRun` computes **every** divergence, then:

1. No differences at all → `PASS`.
2. Differences exist → every one of them (and every changed outcome field) must find an `allowed` entry with
   the **same field name** and an `absDelta <= maxAbs`. If all are covered → `EXPECTED_DIFF`.
3. Anything left uncovered, any declaration that fails validation, or any non-finite/non-numeric value →
   `DIVERGED`.

Consequences worth stating plainly:

- A declaration for `x` does **not** cover an `angle` change, or a crash-tick change, on the same run.
- A declaration wider than the observed delta still reports `EXPECTED_DIFF`, not `PASS` — the difference
  stays visible in the report and in CI logs.
- A malformed `expected/<id>.json` is an error, not a silent pass. `validateExpected` throws on a missing
  `reason`/`reviewer`/`reviewedAt`, a non-numeric `maxAbs`, or an id mismatch.
- Deleting a declaration is always allowed; the difference simply returns as `DIVERGED`.

## Review workflow

1. A PR changes handling/physics. CI (or a local run) reports `DIVERGED` with the first divergence at a
   specific tick and field.
2. Take the two records — the golden and the current `out/<id>.json` — and diff them. Decide whether the new
   behaviour is the intended one.
3. If it is intended, add `expected/<id>.json` naming **only** the fields and magnitudes that actually moved,
   with a reason that explains the mechanism and a named reviewer.
4. Re-run `node tools/canaries/feel-diff.mjs --use-out`. It should now report `EXPECTED_DIFF`.
5. If the new behaviour is the *new intended baseline*, the honest move is to re-record the golden
   (`--record-golden`) in the same reviewed PR and delete the expected entry — a standing declaration slowly
   becomes a blind spot, so prefer re-baselining over accumulating approvals.

## What an approval is not

It is not a fairness proof, an anti-cheat statement, or a statement about the official ruleset. Canary
records are single-machine, headless-Chromium regression artifacts; see `tools/canaries/README.md`.
