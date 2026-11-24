# Netlify preview budget and exception ledger

Owner directive: Marvin Bentley, November 23, 2026. **Skip Netlify by default.** This project has exhausted this month's Netlify build-minute allowance. No new preview is authorized merely because a PR exists.

The initial title of EVERY new PR must contain `[skip netlify]`. The GitHub connector's initial PR-creation action, CLI (`gh pr create --title ...`) and any automation must include that marker at creation time. This prevents an initial title-update race that could start a Netlify build. Preserve the marker during reviews, rebases, and CI. Changing it only after a Netlify preview has started is too late to save that build.

Exceptions require a concrete reason: Marvin explicitly requests a deployed PR for his own testing, or Friday identifies a test requiring Marvin to use Netlify's hosted preview. **Friday/team discretionary budget: up to 10 total opt-in preview builds per calendar day in America/New_York, shared across all agents.** Marvin explicitly requested additional builds are outside that allowance. Default zero. Count individual preview builds, not PRs: if an unskipped PR is pushed twice and creates two previews, that is TWO discretionary builds. Coordinate multiple re-runs and push updates before unskipping to avoid surprises.

Before unskipping: check this ledger AND the [GitHub exception issue](https://github.com/truevox/BitstreamBluffs/issues), confirm the exact day's consumed count, and log the PR, human-testing purpose, requesting actor, date, and preview count. **Do not unskip without a dated ledger entry.** If a requested preview is accepted, batch changes first; when possible restore `[skip netlify]` immediately after that preview is available. If the daily discretionary quota would be exceeded, keep skipping and escalate to Marvin for a specific exception. Do not count an old, already-built preview as a new build merely because you inspect it.

## Current ledger

| Date (America/New_York) | Friday discretionary preview builds explicitly approved | Marvin-requested previews (additional) | Notes |
|---|---:|---:|---|
| 2026-11-23 | 0 | 0 | As of policy adoption, Friday opted into no **new** previews. Previously queued Netlify builds are not counted as newly authorized exceptions. All 53 then-open BsB PRs were marked `[skip netlify]`. |

This ledger is conservative and records authorization, not a verified account-wide historical build count. Netlify project billing/deploy history remains authoritative for actual minutes and builds; an authorization does not prove that Netlify executed it. Any daily consumption not verifiable must be treated as uncertain until checked.

## Non-Netlify verification

Use `npm test`, `npm run build`, local `npm run preview`, local/connected Chromium, fixed-seed deterministic replay and source/build identity checks. GitHub Actions may continue to run, even when PR previews are skipped. For main production deployments, explicitly distinguish code merges from new public deployment: Netlify may rebuild `main` despite a skipped PR preview. A production deploy is not a free PR-preview exception.

## Source and provenance

User's direct 2026-11-23 instruction to Gal Friday: mark most PRs `[skip netlify]` unless Friday explicitly needs Marvin to test that PR through Netlify's tools; up to ten discretionary exceptions per day plus all Marvin-requested exceptions. Operational details and ledger are Gal Friday's implementation, not new owner-stated demands. Canonical local GBrain: `projects/truevox-bitstreambluffs/netlify-preview-build-policy`.
