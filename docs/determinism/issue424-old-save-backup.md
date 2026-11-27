# #424 — explicit inert backup of incompatible one-use Suspend slots

## User problem

An exact-build READY save survives a PWA upgrade by design, but cannot
be resumed by an incompatible runtime. In v2.25.32, Title offers only
CLEAR OLD SAVE and a two-click erase. A player without an intact old
browser build has no way to preserve the old bytes before optionally
discarding the browser slot.

## v2.25.35 narrow correction

Title displays a SECOND separate BACKUP SAVE chip above the unchanged
CLEAR OLD SAVE chip only when peekManualSuspend classifies the
slot as incompatible. First player click copies an existing READY
IndexedDB record in a readonly transaction, with a 16 MiB bound.
It does not require current-build validation, which would defeat the
purpose of backing up an older format. It does not change the source
record, take a claim, release an old claim, consume a save, set game
registry data or spawn a RunScene.

A second physical click (or keyboard E twice) requests a browser
download using a newly activated, same-turn anchor. The file contains
the exact original raw envelope bytes and a safe metadata-only
filename bitstream-suspend-<build hash prefix>-tick<N>.bbsuspend.
No run-controlled ID becomes a filename. If file permissions, object
URLs, browser policy or browser download block the request, the
original READY slot remains intact.

Neither the stored bytes nor the downloaded file can be imported or
restored in v2.25.35. This is an inert personal recovery copy, not
a GhostTape, a reusable Save/Load shortcut, a public Verified assertion,
Shard authority or a promise of future migration. Since local data
can be copied independently, the export is not a new authenticity or
anti-cheat guarantee. Any future restoration/import policy requires a
separate explicitly reviewed contract, with repeatable practice marked
unranked and local state never promoted to public Verified evidence.

The original CLEAR OLD SAVE button and its two physical confirmation
clicks remain unchanged. BACKUP SAVE is not offered on READY for the
current build, claimed, unavailable or corrupt slots. Empty slot hides
both controls. A requested browser download is not confirmation
that a file was durably saved; the interface states this explicitly.
All data remains local; no cloud upload, telemetry or network mutation.

## Evidence / permanent gate

- Unit tests: LocalSuspendSlot.backupReady has readonly/no-write
  semantics, defensive detached bytes, status enforcement, byte caps,
  hostile metadata and denied-IDB behavior. The old 2-click clear,
  claimed ownership and native single-use tests remain in force.
- Real compiled v2.25.31 -> v2.25.35 PWA worker upgrade: actual
  v31 paused stock run creates an authentic READY envelope; another
  controlled v33 service worker installs while old pages remain open;
  after all old pages close, a new page starts fully offline.
  Title sees incompatible, no Resume, CLEAR OLD SAVE unchanged,
  BACKUP SAVE visible and enabled.
- First physical click only prepares an inert copy, preserving the
  original IDB record byte-identically. Second click produces a
  browser download whose SHA-256, length and filename are checked
  against the ORIGINAL persisted record; IDB remains READY.
- Only after explicit two-click CLEAR OLD SAVE does the source READY
  slot disappear; both buttons then disappear. No JavaScript errors,
  cross-origin uploads or outbound writes.
- This proves the app's download request and headless Chromium's
  downloaded bytes, not durable storage on a particular real
  Chromebook or player-managed backup location. Physical devices
  and broader mode support remain under #424/#119.

To reproduce in local compiled output:

    node tools/savestate-experiment/test-crossrelease-pwa-suspend-backup-browser.mjs /path/to/v2.25.31/dist /path/to/current/dist --real-v31

The repo's savestate-crossrelease-pwa-qa.yml builds both exact source
revisions and executes that permanent acceptance test. No
SIM_REVISION, physics algorithm, recording format, save schema, public
proof policy or legacy save bytes are modified by this UX feature.
