# #424 — Save-side manual Pause source retirement (stacked, dormant UI)

Source dependency: #426 exact layout/IDB candidate bridge, #427 real
page-reopen proof, and the existing authored 26bae57a manual-pause
capture adapter. New work is on a DISTINCT branch, no force-push
or modification of the upstream author's branch. This is a follow-on
source gate, not a replacement for #426 or #427.

What the new internal controller does:

- Require a *real native manual PauseScene* state, an eligible
  completed-tick source, exact current build identity, and the
  reviewed pause capture adapter. Refuse practice/coach/takeover,
  Daily, active upgrades, magnets, Kodiaks or unsupported modes
  instead of inventing conversion/migration.
- Capture only the unpaused transient guard while the original
  remains paused, then restore that guard in a finally block.
- Build the registered canonical suspend envelope and write to
  the EXISTING single-use IndexedDB slot with replace=false.
  Another pending/claimed save is not silently overwritten.
- Reject quota, blocked storage, missing exact identity, incompatible
  source and capture failures *before* retiring the original.
- Only after durable put, synchronously emit RUN_ABORT with reason
  suspend, stop the frozen source RunScene and its UI, and return
  to Title. A post-commit scene-manager error never clears the
  saved slot or unlocks the original run.
- No duplicate reward, public Verified, leaderboard privilege,
  replay claim or cloud upload. Nothing is automatic.

The PauseScene._suspendRun entrypoint is intentionally not attached
to a visible menu action until the matching actual player Resume
host is implemented and passes independent same-scene lifecycle,
storage, PWA and receipt/trust gates. An orphaned "SUSPEND" button
that a player cannot Resume is worse than keeping the tested source
method dormant. Existing Pause/Restart/Quit controls remain unchanged.

Focused unit tests validate refusal, durable-write/retirement order,
occupied/claimed/quota failures and irreversible post-commit
retirement errors. Native browser acceptance exercises *actual*
RunScene.pauseRun() -> PauseScene._suspendRun() -> original source
retirement to Title, original page close, reopened game page on
the same IDB partition, fresh exact build claim, competitor refusal,
zero-tick native reconstruction, one-time consumption, subsequent
fingerprint and fatal record/tape parity. A separate reference
browser context provides the source timeline, because the actual
source is correctly retired.

P0 #119/#424 remain OPEN. The complementary user-visible Title
Resume activation, same-page quarantine/scene swap, non-stock
configurations and durable failure-report UI remain outstanding.

## Verified local acceptance

25/25 combined focused unit tests for the manual pause capture adapter,
source write/retirement ordering, refused modes, conflict/quota/storage
failure and irreversible post-commit result status.

Real native Chromium from exact source:
- Source PauseScene at completed stock ticks **481** and **936**.
- Durable single-use outer envelopes **458892** and **514460** bytes
  respectively; no overwrite of another READY or CLAIMED slot.
- Source RunScene and PauseScene actually stopped, TitleScene active,
  source page physically closed.
- Opened a fresh game page in the SAME browser-context IndexedDB
  partition; competing claim refused, zero simulation ticks on native
  restore, original _manualPausePending cleared in restored continuation.
- Original fingerprint at the resumed tick and all **496 + 41 = 537**
  subsequent fingerprints match an independent unsuspended control
  run, as do the native fatal tick 977, GhostTape and RunRecord.
- Zero page errors. Context blocks nonlocal HTTP requests, including
  the ordinary playtest telemetry upload URL, so these artificial
  QA runs cannot contaminate the playtest sheet.

The above is source-side QA invoked through PauseScene._suspendRun()
by the browser test. It does not yet demonstrate actual user
clicks, same-page quarantined stage publication or PWA/Chromebook
recovery. No visible Suspend button is enabled by this PR.

The later exact-source browser rerun additionally proves an occupied-slot
conflict at tick 481: invoking the same real PauseScene action with an
existing READY slot refuses without retiring/advancing the original,
allows the player to remain paused and try again after explicit
cleanup, and only then commits and retires the source. This does not
silently replace an existing saved run.

The real QA browser explicitly blocks every nonlocal origin at the
browser context network boundary, so simulated runs and RUN_ABORT
events cannot reach the playtest telemetry endpoint.

An **uncertain** IndexedDB write result is different from a known
aborted/quota/occupied transaction. When the save may have committed
but its acknowledgement was lost, the source remains permanently
paused/locked instead of playing a second copy. The source may
continue after an explicit pre-write refusal or known transaction
abort. This intentionally favors one-use correctness over a
speculative recovery; a visible recovery flow still needs to report
and resolve that exceptional case.
