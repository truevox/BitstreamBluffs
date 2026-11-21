# #176 — GitHub-native Friday review handoff reconciliation

The existing lifecycle Action did not handle review-request comments and skipped PRs unless their bodies had an exact `friday-issue` marker. See Morgan's #174: a trusted `[GAL FRIDAY REVIEW REQUEST]` with exact HEAD existed, but issue #79 was never labeled `friday:in-review`.

Implementation stays in `.github/workflows/friday-pr-lifecycle.yml`, with a separately unit-testable `.github/scripts/friday-pr-lifecycle.cjs`. The Action checks out **the repository's default branch only**, never PR code, and uses only `GITHUB_TOKEN`. It recognizes unambiguous Friday issue markers, `Refs/Fixes/Closes #N` at line start, or `[#N]` titles; ambiguous parent identification is rejected. It derives the review queue from trusted review messages tied to the *current* commit SHA.

The Action is event-driven by PR lifecycle, review comments and native review events. It does not auto-merge, never marks draft PRs in review, never calls user code, and does not mark partial `Refs #N` scope complete. A standalone test simulates existing PR conventions and stale comments without GitHub network access. A manual `workflow_dispatch` option can reconcile a previously missed handoff.
