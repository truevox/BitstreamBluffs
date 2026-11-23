# Repository agent instructions

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
