# #119 / #424 — local one-use player Pause → Suspend and Title → Resume

This is a real player interface for eligible stock runs, not a simulated
snapshot viewer, rewind checkpoint, server Verified issuer or leaderboard
authenticator. Manually pausing an eligible unmodified run exposes SUSPEND RUN.

The existing one-use IndexedDB slot stores the exact causal tick and original
GhostTape recorder. Only after a complete, exact identity-bound validated
write does the old run stop. Storage denied, quota exhausted, an occupied slot
or an invalid candidate keeps the original run paused with an explicit error;
a second save cannot silently replace the first.

Title uses readonly status, NEVER auto-claim. R RESUME SAVE appears for READY,
same-build saves. A deliberate click atomically claims the exact slot,
validates the build/physics/layout/header, sets the stored seed/config,
prepares a real invisible paused Matter RunScene with Title still active,
restores native typed state/recorder without replay ticks, and consumes
the exact ownership token BEFORE releasing input/HUD or issuing ONE resumed
RUN_START event. A failed restore discards the stage, restores original
registry settings, and releases only its claimed token for retry. A thrown
postcommit observer cannot discard the unique consumed run. Local-only
continuation confers no server Verified status.

An incompatible or corrupt save shows CLEAR OLD SAVE / CLEAR BAD SAVE and
then requires a second physical click on CONFIRM ERASE. No status preview
or failed resume auto-deletes the save. Claimed slots cannot be erased from
another tab, even if ownership is stale.

Only manually paused stock runs are supported. Upgrades, boosts, official
daily, ghost replay/takeover, gym, practice, modified content, missing tape
and crashed runs are rejected. No auto-upload. Still outstanding for #119:
physical Chromebook signoff, installed PWA reload/eviction experiments,
crash-held claim recovery and expanded config matrix. Public independent
verification service is separately tracked by #135.

The Pause panel opens with an animated CRT transition. All MenuList zones
and keyboard confirmation remain inactive until geometry settles. This
prevents a pointer targeted at SUSPEND from landing on the adjacent QUIT
action while the panel is moving. The browser QA intentionally clicks
before this transition ends, confirms the original run is still paused,
then performs the normal post-transition Suspend action.

Required Chromium gates: a real mouse-click Suspend / page-reload / click
Resume at exactly the original tick; a deliberately failed late reconstruction
with registry rollback and retry; a hostile postcommit observer; an actually
corrupted IndexedDB save requiring two physical clicks to erase. The native
481/936 exact full-suffix and GhostTape equivalence tests remain independent.

Provenance: Gal Friday implementation of Marvin's pre-existing single-use
product decision, not a newly inferred user request. Canonical GBrain:
[[projects/truevox-bitstreambluffs/determinism-opportunities/op-052-heavy-mode-trusted-savestates]].
