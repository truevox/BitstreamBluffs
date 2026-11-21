# #176 — Friday exact-HEAD review-queue lifecycle

## Why this patch exists

The existing #153/#154 workflow only listened to PR lifecycle events and only recognized `<!-- friday-issue: N -->`. Morgan's #174 had `Refs #79` and a clear `[GAL FRIDAY REVIEW REQUEST]` comment, but no `friday:in-review` label. The review was overlooked. The canonical source of this workflow is also shipped as a companion template by the private `truevox/skills` `friday-github-lifecycle` skill; keep both copies synchronized when updating the template.

## Installed model

- A **read-only** `.github/workflows/friday-pr-lifecycle-signal.yml` receives `pull_request`, `issue_comment` and `pull_request_review` events. It writes only a tiny validated numeric PR pointer artifact, with no checkout and no permission to modify issues. The **privileged default-branch-controlled** `.github/workflows/friday-pr-lifecycle.yml` handles its `workflow_run` completion plus manual `workflow_dispatch`. It checks artifact count/size, treats the pointer as untrusted, re-fetches the PR via GitHub API and runs only its own default-branch helper.
- The trusted privileged `workflow_run` workflow definition exists on the **default branch only**, and checks out **only that branch**, not PR code. The input collector may run on a nondefault PR base but has no issue-write permission; it never checks out or executes PR head code. The writer never runs the collector artifact as code. It uses built-in `GITHUB_TOKEN` (`contents:read`, `issues:write`, `pull-requests:write`), does not merge, and executes `.github/scripts/friday-pr-lifecycle.cjs` only after that script has landed on the default branch. During the patch's own PR, the script is not installed yet, so the Action reports its pending status and does not load the untrusted PR copy.
- A linked issue is recognized through an unambiguous `<!-- friday-issue: N -->` marker, a top-level `Refs/Fixes/Closes #N`, or a `[ #N ]`-style bracketed issue number (without the spaces) in the PR title. Fenced code, multiline backtick code spans, indented code, HTML comments and `<pre>` examples are excluded from closing-keyword parsing. Conflicting/ambiguous references are skipped; the linked item must actually be a GitHub **issue**, not another PR.
- A **trusted write-capable repository member's** `[GAL FRIDAY REVIEW REQUEST]` comment with **exact, current 40-character HEAD** and a ready/non-starter PR moves both the PR and parent issue to `friday:in-review`. A changed HEAD invalidates the old request; moving a PR back to draft also clears it. A starter marker with `status: removed` is not considered present in the final PR.
- A matching `[GAL FRIDAY REVIEW PASSED]`, `CHANGES REQUESTED`, native GitHub `APPROVED` or native `CHANGES_REQUESTED` verdict leaves/reverts both to `friday:in-progress`. The current verdict is computed from authenticated comments plus reviews on the current HEAD. In particular, GitHub won't allow the PR-owning `truevox` identity to submit a native `APPROVE`: Gal Friday's tool posts a `COMMENTED` review with `[GAL FRIDAY REVIEW PASSED]`, which is **only a label bookkeeping verdict**; it does **not** bypass GitHub's independent-review branch protection.
- A read-only parent-routing job serializes label writes **per linked issue**, not per PR, and preserves pending handoffs with `queue: max`. The pointer artifact is strictly validated as a number plus an allowed source-event name; its untrusted contents never become shell commands or JS source. It re-reads current sibling PRs and current issue labels immediately before the parent transition. Shared parent issues (e.g. #172's two draft PWA PRs) stay `friday:in-review` if **any** linked open PR is genuinely awaiting review; otherwise they remain in progress while an open PR exists.
- After merging a PR to default: its own label becomes `friday:done`. **Only an explicit full-scope `Closes/Fixes/Resolves #N`** can mark its parent issue done/close it (and only when no other linked PR remains open). A partial `Refs #N` PR does **not** close the issue; stacked merges into feature branches also do not close it. GitHub's own keyword auto-closure still applies, so partial-scope PRs must **not** include a `Closes #N` keyword.
- The earlier changed-file and declared-scope overlap advisory remains available on Friday-marked PR lifecycle events, without executing PR code.

## Handoff for agents

1. Claim an issue and open an isolated draft PR (no review label while draft).
2. Finish tests and remove any `.friday/issue-N-start.md` marker; push your final HEAD and mark ready.
3. Post exactly one clear `[GAL FRIDAY REVIEW REQUEST]` comment with the **full current HEAD SHA** and the verification summary. The GitHub Action labels both PR and issue; no agent-side hooks are required.
4. Gal Friday reviews the exact HEAD and submits `[GAL FRIDAY REVIEW PASSED]` or feedback. The Action clears the review label; a new commit requires a new handoff. Separate native required approvals continue to be enforced normally.
5. Merge through the approved orchestrator; keep a partial parent issue open. No automatic merge is performed by this workflow.

For earlier missed handoffs after the workflow is merged, use **Actions → Friday PR lifecycle → Run workflow**, set `pr_number` to the relevant PR. This recalculates only from real GitHub state; it does not manufacture any approval.

## Verification

- `npm test -- --runInBand tests/github/friday-pr-lifecycle.test.js`
- `node --check .github/scripts/friday-pr-lifecycle.cjs`
- YAML parse/lint: inspect both workflows, distinct unprivileged signal and privileged `workflow_run`, default-branch checkout, artifact validation, least-privilege permissions and startup guard.
- The test harness mocks GitHub REST API calls, and checks handoff + approval, stale HEAD, draft/starter (including deleted starter), same-issue multiple PRs and interleaved events, partial versus complete merges, fenced/example keywords, scope-overlap advisories, fork/untrusted comment rejection, native review events and manual recovery.
- Read-only live-API parsing checked PR #174 (request as an `issue_comment`, approval as a `COMMENTED` PR review), CC Friday's #163–#166 bracketed titles, Team B's #159–#162 Friday issue markers, Home Friday's #158 `Closes`, and both PWA #172 drafts. No labels were mutated during that read-only check.

Both the event collector and its privileged writer must land together; the Action's behavior is **not live** until this reviewed PR lands on the default branch. Do not report it as installed merely because the tests pass.
