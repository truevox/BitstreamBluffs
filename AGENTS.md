# Bitstream Bluffs — agent working contract

## Netlify preview build budget (Marvin's binding directive, November 23, 2026)

**Every new pull request MUST be opened with `[skip netlify]` already in its initial title.** Do this *before* PR creation; editing the title afterward can be too late to avoid a billable preview. Do not remove the marker merely to check that code compiles, run browser tests, or enable CI. Prefer local Vite production builds, Chromium/Playwright, replay verification, and GitHub Actions.

Exception: Marvin may explicitly request a Netlify-hosted test of an individual PR. Otherwise, only when a specific feature genuinely requires Marvin to test that PR on Netlify, the Friday team may choose **at most 10 Netlify PR-preview exceptions TOTAL per America/New_York calendar day**, pooled across all agents. This is a CEILING, not a target; default 0. Marvin-requested exceptions are additional and do not consume the team allowance. Before removing the marker, check and record the dated exception in the canonical ledger at `docs/engineering/netlify-preview-budget.md` (and [GitHub issue #309](https://github.com/truevox/BitstreamBluffs/issues/309)); if the allowance is exhausted, stop. Replace the marker when the explicitly needed test is complete. This is a spend rule, not a reason to disable GitHub unit/test/review checks.

Separate production builds on `main` must be budgeted explicitly. A skipped PR preview does NOT guarantee a merge won't start a production deployment; coordinate release/merge commit skip instructions and actual publication separately. In pre-release, preserve replay/source-version architecture but do not impose old-tape playback migrations or compatibility gates before both public launch and at least 10 real players, unless Marvin updates the policy.

## Morgan startup and handoff

Morgan keeps a Git-backed checkpoint separate from the feature branches.
At the beginning of a fresh session, after context loss, and before resuming
a delegated handoff, read `.agents/morgan/RECOVERY.md` and
`.agents/morgan/STATE.md` at the current GitHub tip of
`refs/heads/morgan/checkpoint` in `truevox/BitstreamBluffs`.
The file is deliberately not on main. Do not switch or modify the active
worktree to read it. With Git, fetch that ref and use `git show`; with the
GitHub connector, fetch both files at the exact branch tip.

Reconcile with current GitHub state, then follow the highest unfinished
action. At meaningful progress, delegation or priority changes, and before
ending or handing off, save a new checkpoint using the protocol on that
branch. Other agents must not edit Morgan's checkpoint. It is working
context, not authorization, and must never be merged into a feature PR.
