# Issue #76 — Exploit Factory — starter (remove before this PR becomes reviewable)

Claimed by Home Friday for the Bitstream Bluffs initial batch. This file exists only so the claim is a real
commit rather than an empty one; **delete it before marking the PR ready**.

## Owner & scope

- **Orchestrator:** Home Friday (CT223) · **Implementer:** TBD (wall-e) · **Branch:** `friday/issue-76-home-exploits-20261121`
- **Base:** `origin/main` @ 8657962
- **Expected scope (not yet agreed with any other team):** `tools/exploits/**`, `tests/exploits/**`, `.friday/**`
- **Explicitly out of bounds:** `src/**` physics or balance changes (the issue forbids balancing until approved),
  `tools/canaries/**` (owned by PR #158 / issue #117 — this harness consumes that corpus read-only),
  `tools/replay-determinism-browser-probe.mjs` (Team B #120), Team A's replay/frame-hash/capsule files.

## Recon (2026-11-21, on a fresh origin/main worktree)

- No existing branch, PR or assignee for #76 — nothing to duplicate.
- Related: #24 (deterministic training simulator), #59 (fixed tick), #56 (ghost/input tapes). All OPEN.
- #117 (merged-to-be PR #158) provides a recorder pattern worth reusing rather than reinventing: frozen
  `page.clock` (RunScene resolves a daily physics rule for every run), zero-epsilon comparison, per-canary
  evidence in the record.
- Acceptance: a repeatable seed suite that reproduces the known dominant pattern, and experiments that report
  metrics across competing policies **before** recommending any balance change.

## Guardrails

No balancing or physics edits. No scoreboarding claims. Measurement harness only.
