# #69 — local-only portable `.bbghost` fallback (draft)

A Ghost Link URL may legitimately exceed 8,192 characters; the current client
must refuse a too-long URL rather than silently upload inputs or embed a write
credential in public JavaScript. This scoped implementation adds an **explicit
local file** fallback, not hosted sharing, and keeps the present short-URL
fragment behavior unchanged. No network requests or compulsory account.

Both transports carry the same strict current-SIM versioned allowlisted ghost
input: no player name, original run ID, timestamps, profile, credentials,
wallet, telemetry, or other arbitrary tape extensions. A `.bbghost` package
contains a small versioned magic header, an unkeyed compressed-payload SHA-256
integrity checksum, and bounded gzip bytes. **A checksum is not proof of who
played, legal loadout, authentic outcome or ranked eligibility.** The imported
trace remains unverified, view-only until explicit Preview, then optional
separately confirmed **UNRANKED** practice with no score/XP/wallet/storage
change. Never auto-import a download or navigate to a local file URL.

Sender must select SHARE LINK, review that inputs/loadout/score leave the device,
then separately choose SAVE FILE if the payload is too big for a portable URL.
The file download is a local browser gesture, never an upload. Recipient uses
an actual native file input (including keyboard/touch) to choose `.bbghost`,
with bounded byte read and no implicit score import. Malformed/unsupported or
oversized packages must fail closed, clearing stale previews and guest-practice
permission. A cancelled or newly opened file picker also clears a prior
second-click RACE confirmation without forcing the user to re-preview the same
valid file. Guest practice never persists normal-play tutorial completion (`bb.tutorialDone`) or
tuck-hint show counts (`bb.tuckShows`); both may advance in memory during the
practice session, but cannot consume future first-run guidance.

No remote-host fallback, real-device Chromebook/Android acceptance,
producer authentication, #72 authoritative takeover or #135 public verification
is claimed.

The original standalone #374 draft is based on v2.22.7; the separate #383 integration
candidate is proposed as **v2.22.11**, stacked after #244 v2.22.8,
#242 v2.22.9 and #68 v2.22.10. Neither draft is a public release.
Original #374 stays intact until Morgan completes its independent review.

## Exact-source QA (development draft)

- 13/13 link + file serialization and version/fuzz tests; 64/64 focused
  GhostLink, guest-practice, course-boundary, title/preview and portable file
  tests on unchanged v2.22.7 SIM9 base.
- A real normal SIM9 run was captured, then **its trace was deliberately
  lengthened with synthetic finite 30Hz poses solely for transport testing**.
  This is not a claimed natural 6,000-tick authoritative game outcome. The
  14.9 KiB compressed package cannot be represented by the 8,192-character
  URL and remains under the 20 KiB decompression-input limit.
- In real Chromium desktop and 412x915 mobile emulation, a genuine download
  event occurred only after the first disclosure then second SAVE FILE click.
  Navigating away cancelled the first authorization. The browser's actual
  filechooser opened from a native file input (real pointer and Space-key
  activation); its selected file produced one
  unverified 1,200-point trace. Corrupt replacement cleared the preview and
  disabled RACE; explicit two-stage guest practice started without a recorder
  or any change to full profile JSON, saved run list, course or tape counts.
  No JavaScript exceptions; zero attempted cross-origin writes. The game's
  existing remote audio GET may still be attempted and is blocked in QA.
- The same full round-trip passed from the compiled `/BitstreamBluffs/` Pages
  subpath on desktop and mobile emulation; source ruleset identity unchanged.
- Source and CI still require exact-head review before merge, then a version
  coordinated after the pending v2.22.8/9 stack and #68. Real physical
  Chromebook/Android and optional user-controlled hosted fallback are **not**
  covered by this local-file fallback.
