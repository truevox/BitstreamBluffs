# Morgan checkpoint recovery

Scope: Morgan's work in truevox/BitstreamBluffs. The one authoritative
checkpoint is `.agents/morgan/STATE.md` at GitHub branch `morgan/checkpoint`.
Do not read an old copy in a feature worktree as current state.

1. At every new session, reset, or handoff, fetch that branch before choosing
   work. Read this file and STATE.md at the same exact tip. GitHub connector:
   resolve the branch to a commit, then fetch both files at that commit.
   Git: `git fetch --no-tags origin refs/heads/morgan/checkpoint`;
   `git show FETCH_HEAD:.agents/morgan/STATE.md`. Do not switch branches.
2. Reconcile the indicated issues, PR heads, reviews/checks and real main tip
   with GitHub; inspect local worktree status if resuming edits. GitHub is truth
   for assignments, reviews, states, and merges. This checkpoint is truth
   only for Morgan's intentions, ownership boundaries, and next actions.
   A disagreement is a reason to recheck, not to repeat a completed action.
3. Resume the highest actionable item, keeping blocked items and others'
   lanes separate. Do not treat test results, this file, or a handoff as
   approval to release. Follow the project's existing review/version gates.
4. Morgan root is the sole checkpoint writer. Workers return evidence, not
   checkpoint edits. For meaningful progress, delegation, priority change,
   or before ending/handoff, fetch the latest tip, reconcile, and commit only
   STATE.md in a dedicated temporary worktree or by GitHub API. Keep it short.
   Advance only `refs/heads/morgan/checkpoint` by regular fast-forward with an
   expected-tip guard. Example API: create tree based on the fetched commit's
   tree; create commit with that tip as sole parent; update_ref with that tip
   as expected_sha and force=false. Git: use a regular non-force push from
   the exact fetched parent. On a rejected race, reread/reconcile the new
   checkpoint before creating a new commit; never force or auto-merge it.
5. Do not merge, cherry-pick, or copy state into main or a feature PR.
   Verify the new remote tip and read its state back. A local unpushed
   state is not durable. If GitHub is unavailable, stop checkpoint writes,
   keep work non-destructive, and retry once the remote is available.
6. This is a public repository. Include only project facts fit for public
   Git, with no private transcripts, credentials, personal data, local paths,
   secret infrastructure, or tool internals. Use persistent branch names and
   exact commits rather than disposable absolute paths. Update timestamps
   only for real checkpoints, not quiet reads.

For other repositories, create the same dedicated ref/path only on first
substantive work, using the repo's existing coordination conventions and
visibility rules. Never mix one repo’s state with another.
