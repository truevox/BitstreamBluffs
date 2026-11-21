# #172 PWA — Real mono music tiers + three-way owner preference

**Draft-only, stacked on #182 → #179 → #175 → #173. No production SW is registered.**

**NON-DESTRUCTIVE OWNER REQUIREMENT (2026-11-21): Original stereo 48 kHz Ogg/Opus masters MUST be kept indefinitely, even if all current gameplay sources become mono. Do not delete, overwrite, re-encode in place, prune, garbage-collect, or replace the source stereo directory as part of building Lite/Full derivatives, a PWA upgrade or a user choosing Space Saver / No Music. Both mono tiers are additive alongside the existing stereo masters. The encoder rejects source/output root overlap, symlink escapes and **every already-existing output file** (FFmpeg `-n`). Existing source masters are the archival source of truth and must remain available for future stereo restoration or revised mixes. Cache eviction/cleanup can operate only on downloaded client-side derivative caches, never repository/archive original masters.**

## Owner's actual choice (November 21, 2026)

Music Quality is a **three-option setting independent of track enable/unlock**:

| Choice | Music playback | Offline downloads / storage |
|---|---|---|
| **High quality** | Start using original-performance Lite mono, then move to higher-quality Full mono at a safe playback boundary | Acquire *all required Lite groups first*, then build Full groups online; do not prematurely swap half a song to Full |
| **Space saver** | Only the original-performance Lite mono stems | Acquire Lite only; do not download Full. Do not delete already cached Full stems merely because the setting changed |
| **No music** | **Silence from both original stem engine and procedural music fallback; SFX remains enabled** | No new audio downloads; do not erase selected song preferences or automatically delete the caches. Cache cleanup is an explicit separate action |

Actual selected songs remain separately ON/OFF. A song that is locked or switched off is not a required download. Currently required unlocked/on songs + active biome assets must be fully verified; next-biome pre-unlock assets are **bonus after required groups**, not a readiness gate.

## Delivered in this draft

- **Actual game menu:** Settings → Manage Sound → **MUSIC QUALITY**, tri-state HIGH / UPGRADE, SPACE SAVER, NO MUSIC, marked EXPERIMENT to avoid promising deployed support. `SaveStore` remembers `musicQuality:'high'|'saver'|'off'`, sanitizes old/malformed saves to `high`, and does not mutate `musicEnabledSongs` or the SFX slider.
- **Actual shared AudioSynth:** `musicQuality:'off'` immediately stops the real stem transport **and** procedural synth timer; SFX still uses its separate bus. Returning to `high` or `saver` can resume the saved original song selections without being forced to re-enable every track. No physics, RNG, replay/ghost, score, music source selection, or committed recording bytes are changed.
- **Offline preference policy:** pure planner (`music-quality-policy.mjs`) emits required Lite groups first, followed by Full only when High is selected, then optional Lite/Full lookahead after those. Explicit Full promotion only when every required Full group is integrity-complete and caller says it is at a safe segment/song boundary. Space Saver never silently selects Full from a cache if Lite is missing. OFF never schedules media downloads.
- **Integrity-backed quality manifest:** mono derivative entries are keyed to their *logical* original `/music/packs/...` URL; a separate *physical* versioned `/music-variants/lite|full/packs/...` recording URL carries the SHA-256, size and source proof. Non-audio `pack.json`/caption resources remain original and the same logical URLs. Reject missing, mismatched or non-mono derivatives, duplicate logical entries, redirects and path escapes. Each song/biome/quality group uses its own complete marker and hashed inventory.
- **Developer-only SW route:** the current real `StemMusicDirector` continues to fetch its unchanged logical original stem paths. The worker serves **one selected mono quality from complete verified groups** for the entire song. It will NOT use incomplete Full recordings, does not cache arbitrary network audio, and does not choose Full midway through a song just because background downloads finished. A same-origin, explicit `bb-set-music-preference` message carries the active quality and required group IDs; it persists separately from audio caches and acknowledges **only after** its CacheStorage transaction completes (MessageChannel). User switching modes does **not** delete cached recordings.

### Full-song reproducible Chromium proof

Developer-only `build-tiered-dev-audio.mjs` encoded **all 120 actual original One More Run audio files**, including the 15 Debumont leads; `tiered-plan.json` lists two required logical groups and both derivative qualities. All audio derivatives are **48 kHz mono Opus** from independently addressable original recordings. Their measured downloaded sizes including original metadata:

| Real file set | Bytes |
|---|---:|
| Original stereo recordings + metadata | **10.059 MiB** |
| Lite mono + same metadata | **3.969 MiB** |
| Higher-quality mono + same metadata | **8.120 MiB** |

This is a full-song *size and technical decode test*, NOT an approved subjective listening-quality conclusion.

`test-tiered-offline-audio.mjs` opens a **fresh ephemeral localhost browser origin** and manually installs a test worker there only, then:

1. Opens the actual Manage Sound menu and cycles all three settings, verifies the stored choice.
2. Selects No Music: offline SW refuses physical music fetch (503) with no silent fallback. No music mode in the actual game stops the real stem player and procedural synth while retaining the saved song picks and SFX bus.
3. Selects High and downloads **both complete Lite groups first**; disconnects the browser and reloads the **real built game**. The real `AudioSynth`/`StemMusicDirector` reaches `playing` with seven **single-channel** decoded recordings, with no procedural synth timer. An unchanged logical original drums URL produces the SHA-256 of its genuine Lite mono derivative and decodes in WebAudio.
4. Restores online, downloads Full in separate complete groups. Even after Full is complete, offline logical URLs continue returning Lite until **explicit promotion at an approved boundary**.
5. Deletes a **different Full stem** (Other) to force one group's incompleteness; explicit premature `full` selection fails safely back to the **whole Lite group**, even when requested drums are still cached in Full. Reconnects: the downloader reuses 105 of 106 valid Full group entries and refetches **only the missing recording**. After all Full groups verify, explicitly commits the new active Full quality. The same logical drums URL returns exact SHA-256-checked **Full mono** audio.
6. Selects Space Saver: the URL returns Lite again. Selects No Music: fetch gets 503. Both complete quality tiers stay present after changing settings and are still individually verifiable. No uncaught browser errors.

**Important limit:** The demo chooses the safe-boundary moment manually. It does NOT yet attach to the player's actual 12-second boundary notifications, invalidate previously decoded upcoming segments, or prove seamless *audible* in-run live-quality promotion. Those are explicit release blockers, not something inferred from an HTTP switch test. The user-facing menu is present on this isolated experimental branch, but **it is not yet wired to automatically fetch the user's selected song packs**; worker policy writes and downloads are orchestrated by the test harness. Shipping the UI without a real service worker/downloader would be misleading.

## Reproduce on CT223 / full music checkout

```bash
npm run build
node tools/pwa/build-tiered-dev-audio.mjs /path/to/original/public /tmp/bsb-mono-tiered
BSB_MEDIA_PUBLIC_ROOT=/path/to/original/public BSB_VARIANT_ROOT=/tmp/bsb-mono-tiered \
  CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/pwa/test-tiered-offline-audio.mjs
npm test -- --runInBand tests/src/pwa-tiered-music.test.js \
  tests/src/pwa-mono-stem-variants.test.js tests/src/pwa-music-cache.test.js \
  tests/src/pwa-offline-worker.test.js tests/src/pwa-music-groups.test.js \
  tests/src/pwa-music-download-plan.test.js tests/src/pwa-install-shell.test.js \
  tests/src/pwa-music-integrity-groups.test.js tests/src/sound-hub-settings.test.js \
  tests/src/savestore.test.js tests/src/audio-vinyl-pause-transport.test.js
```

Outputs in `/tmp` only; **never commit full-song OGG derivatives to a source PR**. Original 48kHz stereo source assets are untouched.

## Still required before production

- Implement Settings → Download controls / explicit consent, sizes, progress, cancellation, resume, storage quota UX and automatic preference + song/biome ownership calculation. OFF must cancel an existing background download as well as prevent new ones; sound already stops.
- At safe **actual** song/12s segment boundaries: stop using queued/decoded old-quality buffers, swap to the new version, maintain source sample phase/clock and all adaptive alternates without audible artifacts, and leave active runs undisturbed by service-worker updates. The current manual test cannot substitute for this.
- Real headphone, phone speaker and different-device listening approval of mono downmix and each instrument's VBR budget; preserve originals as masters. Include clipped/cancelled/evicted-caches and network failures, and avoid drift/phase problems.
- Persistent player data, real Android/ChromeOS/iOS/desktop offline cold launch, browser upgrades, browser eviction, multiple tabs, and complete run + score/ghost regression gates. Keep service-worker registration isolated from existing conformance and dev tools.
- Independent read-only security/code review, exact branch tests and final approved integration order. **Do not merge this experimental PR yet; #172 remains OPEN.**
