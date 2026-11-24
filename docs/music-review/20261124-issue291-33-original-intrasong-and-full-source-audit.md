# #291 — The 33-song original audio library: 579 internal segment joins, 99 live boundaries, all 3,672 original OGGs

**2026-11-24. Source-verified engineering QA only; no change to original audio, production music, master gain, game physics, replay rules or public deployment.** Draft PR #310, [skip netlify].

## What was actually tested

The original 33-song music catalog has **612 total original source segments**, with **579 INTERNAL boundaries** between segments within the same song. Each segment contains the six original source OGG roles: vocals, drums, bass, guitar, piano, other. Separately, there are original melody voice overlays and limited legacy adaptive stem variants; this audit deliberately does not claim to exercise those derived/optional assets.

### Original-game real WebAudio handoffs (99 representative boundaries)

tools/music/audit-original-intrasong-handoffs.mjs runs the ACTUAL original StemMusicDirector source scheduler in Chromium. The QA calls its existing resume-offset facility to enter an original song **2.5 seconds before** its first, middle or last internal segment join, then observes native WebAudio source-buffer scheduling through that authentic sample-clock boundary.

- **33/33 original songs PASS**, with **3 different internal joins per song = 99 authentic WebAudio boundary crossings**.
- All **six original roles** on each side: **594 original source timing/decoded buffer comparisons** passed.
- Source-absolute frame clock, AudioBufferSourceNode.start() offset and start/end duration aligned at all 99 boundaries; maximum measured absolute scheduled difference approximately **8.9e-13 ms** (numerical floating-point precision).
- Decoded source duration was tested against ORIGINAL 48-kHz manifest frame length after Chromium converts to its ACTUAL 44.1-kHz device playback context, within 1.5 destination samples. An initial test assumption that resampled buffers would still be 48 kHz failed and was corrected; immutable failed report was never erased.
- This checks native scheduler timing around each selected boundary, not **all 579 transitions individually in real playback**, not the final speaker PCM, and not multi-minute uninterrupted full-song listening.

Independent audit: tools/music/verify-original-intrasong-handoffs.mjs read all immutable per-song browser reports and the original manifests, cross-checked original source/role/source clock and actual scheduled start/end, confirmed **579/579 structurally contiguous original 48-kHz internal joins** and rehashed **3,672 authentic original OGG source files (324,087,653 encoded bytes)** directly from the canonical owner-private archive. The report accepted the intentional per-pack symlinks into the original canonical storage but ensures individual source files resolve only inside their canonical song pack; arbitrary outside-path escapes remain forbidden.

**Independent private immutable report SHA-256: de0560e2101d0478504ad9a055d7c44bf1812d81a9982cb2f951ae5b323ab62d.**

### Every single original OGG decoded in Chromium (3,672/3,672)

tools/music/audit-all-original-ogg-decode.mjs performs an **actual browser network fetch and decode** of all six original OGG stems in **every one of 612 original 48-kHz segments**. The QA uses a 48-kHz AudioContext to eliminate device resampling from this distinct source-frame test, verifies exact decoded frame count, source sample rate, channels and identity, computes the browser SHA-256 of encoded OGG bytes and independently rehashes/readbacks each canonical original OGG file and encoded size in Node. PCM is discarded after decoding; original media is never exported.

The five immutable private batch reports together show **33/33 songs, 612/612 segments, 3,672/3,672 original OGG sources** passed source SHA-256 and exact browser decoded frames.

tools/music/verify-all-original-decode-reports.mjs independently recombines the five reports, checks song IDs and source manifests, counts, duplicates/missing songs, and report integrity. A deliberately tampered copied segment count in memory triggered a **nonzero rejection**, without modifying original files or passing audit JSON.

**Independent private aggregate SHA-256: d81107ac84d6c42a756dbf16494869d5b0e6a81fa1f1e81be3482d6861bca107.**

### Private pack space inventory (not a request to remove any files)

The complete original owner-private catalog overlay resolves to **1,399,900,111 bytes (1.40 decimal GB)**, including metadata. Original six-stem OGG files occupy **324,087,653 bytes**, the 12 melody/instrument-voice source OGG roles occupy **715,723,327 bytes**, and older original adaptive stem variants add **341,088,829 bytes**. Other pack metadata totals **19,000,302 bytes**. The original six plus all twelve voices and existing metadata, excluding optional legacy adaptive variants after the relevant manifest/selection migration, would be approximately **1,058,811,282 bytes (1.06 GB)**. No media removed in this QA PR. Legacy adaptive pack references are still active for the original first four songs; NEVER remove those files without first migrating manifests/selection logic and verifying current real gameplay behavior.

### Limits / remaining release QA

These results establish original media availability, source-accurate OGG decoding and representative actual per-segment scheduling; **they do NOT prove uninterrupted full-duration playback of every song or real-device final mixed stereo audibility**. Certified mastering true peak/loudness, all-biome real-player trajectories, Android/ChromeOS CPU/latency, actual musical beat grid, rights and owner subjective listening remain OPEN. The fresh 33-song quantum-v3b sampled physics BSOD output QA is separate evidence (latest estimated -0.404 dBTP; no calibrated mastering approval). A quiet original-tail listening/crossfade A/B backlog exists as #312; do not automatically rewrite music.

All OGGs and JSON reports remain ONLY on the owner machine. Source-only QA changes; keep **#291 OPEN, PR #310 DRAFT, [skip netlify]**, and do not merge automatically or publish private source files.
