# Independent GitHub App review gate — staged rollout

**Status: staged, not active.** Gal Friday Review is registered and installed on all current and future repositories owned by truevox at Marvin’s request. The app and a repository-scoped token have been authenticated successfully. No branch rule was changed and no PR is merge-blocked by this proposal. The reviewer credential and execution environment still need an independently enforced security boundary before use as a review gate.

## Why stay on GitHub for BsB?

2026-11-23 live audit: `truevox/BitstreamBluffs` is public, has 43 open PRs and 141 open issues, and **main has no protection/ruleset**. Its Forgejo copy at `git.bearcave.win/truevox/BitstreamBluffs` is a GitHub→Forgejo *pull mirror* (8h interval) with PRs and Actions disabled. Making that the primary writable origin is a separate issue/PR/CI migration; don't silently turn off the running mirror or transfer canonical ownership. GitHub remains the source of truth until explicitly changed.

## App configuration and outstanding credential isolation

1. The private **Gal Friday Review** app is registered under `truevox` and installed. A separate root-owned or otherwise genuinely isolated publisher environment is still required; a mode-0600 key under the same Unix user as coding agents is not an independence boundary.
2. Repository permissions: **Metadata read**, **Pull requests read/write**, **Checks read/write**. No Contents, Issues, Administration, Actions, or Workflows access. The owner selected all current and future truevox repositories for the installation; this publisher requests an installation token scoped only to BitstreamBluffs. No webhook required for the initial manually invoked reviewer workflow (future trigger can use a validated webhook).
3. The app is installed across truevox repositories by owner request. Record the App ID, installation ID, and actual slug; generate a private key. Provision that key *outside* the repository, readable only by the isolated reviewer service account, with `chmod 600`. Never paste the key into a PR, chat, GBrain knowledge page, or build log.
4. Do not share reviewer-App installation tokens, key files, or service credentials with the coding agents. The independent reviewer must actually inspect the diff and evidence, not simply publish a second identity for the original author. Keep a separate runtime/security principal for the credential. **Run the publisher from a trusted, installed code copy pinned to a protected revision, never from the PR branch being reviewed** (or a PR-controlled package/dependency). Review evidence must originate from the independent reviewer process, not as an author-supplied unverified artifact.

## Review execution

The reviewer creates a private **JSON evidence file** with the following exact-commit structure (example values are placeholders):

```json
{
  "pr": 42,
  "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "verdict": "approve",
  "reviewerAgent": "Astra Friday",
  "authorAgent": "Morgan",
  "summary": "Reviewed code paths, source and tests; no blockers",
  "findings": [],
  "tests": [{"name":"focused Jest suite","result":"passed"}]
}
```

`verdict` is `approve`, `changes_requested`, or `hold`. A hold is a GitHub COMMENT review plus a failing check, not an approval. If a human listening decision is outstanding, use `hold`, not `approve`. Failed tests or blocking findings cannot accompany an approval. A reviewer who wrote the patch cannot sign off as a different agent; the app's signing authority must be independently isolated.

On the dedicated reviewer runtime, configure `FRIDAY_REVIEW_APP_ID`, `FRIDAY_REVIEW_INSTALLATION_ID`, `FRIDAY_REVIEW_APP_SLUG`, and `FRIDAY_REVIEW_PRIVATE_KEY_PATH` (mode 0600), then execute:

```
node tools/review-gate/publish.mjs --evidence /private/review-42.json
```

The script requests a short-lived, single-repo App installation token, checks the App identity, verifies the PR's **exact live head**, submits a formal review, verifies GitHub identified its author as the expected `slug[bot]` on the exact commit, rechecks the live head, then posts an App-owned `friday-independent-review` check run **on that same SHA**. A head change or bad credentials fail closed; a new push lacks the old SHA's passing check. The repo has no webhook/service trigger yet, so running the script is a separate deliberate act.

## Activate enforcement only after an end-to-end trial

After isolation, integration tests, at least one **real review** and check, and verification that the owner’s requested activation remains safe:

1. Open a harmless test PR, review it from the isolated App, verify `APPROVED` by the App and `friday-independent-review` **success** on its exact head. Request changes on another and verify a failure check. Push a new commit and verify the old green status does not satisfy it.
2. Add a GitHub branch protection rule/ruleset for `main`, requiring PRs and the exact `friday-independent-review` check **from the expected GitHub App**, plus the desired existing CI gates. The App check is the enforcement contract even if its formal bot approval is shown as read-only and does not count toward GitHub's normal approval quota. Do not require an arbitrary count of formal approvals until verified with this App on the actual repository.
3. **Before enforcement, implement and prove invalidation/reconciliation for GitHub review dismissal and change-of-verdict events** (trusted App webhook or independently scheduled review-state reconciliation). A previously successful SHA-scoped check does *not* automatically become failing if an approval is dismissed on the same SHA. Verify a dismissed approval cannot leave a stale green gate. New pushes inherently need a new head check, but dismissal is a different case.
4. Protect `main` against force-push/deletion, choose explicit admin-bypass policy, and verify existing workflows and emergency recovery procedure. Do not enable enforcement while the review App is missing, unavailable, or unable to invalidate a dismissed verdict.
5. Require fresh successful status for every change (review the new SHA); never recycle an old review, PR comment, or self-authored green marker. Record manual human approval for product/audio taste, launch decisions, security-sensitive infrastructure, and other owner-designated gates.

**Security scope:** Source-pure checks and JSON schemas don't establish reviewer independence by themselves. The credential's access boundary and a genuinely separate evaluation process are essential. This CLI does not autonomously review code and does not install/operate the App without the one-time owner action.
