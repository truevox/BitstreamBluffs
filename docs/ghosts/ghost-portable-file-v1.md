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
permission. No remote-host fallback, real-device Chromebook/Android acceptance,
producer authentication, #72 authoritative takeover or #135 public verification
is claimed.

This unversioned draft is based on v2.22.7. Version bump/merge is blocked on
coordinating with pending #244 v2.22.8, #242 v2.22.9, and Team B #68 work.
