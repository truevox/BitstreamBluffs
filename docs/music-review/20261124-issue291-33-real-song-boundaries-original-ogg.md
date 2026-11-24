# #291 — All 33 authentic song-to-song handoffs and original OGG boundaries

**2026-11-24. PASS for tested real-scheduler handoffs, frame-accurate original decoding and source provenance. NOT full-song playback or mastering certification.** QA tools/docs only; no production player, private OGG or approved mix change. Stacked on draft PR #310, with [skip netlify].

## Actual production scheduler, 33/33 song endings

The browser harness tools/music/audit-genuine-song-handoffs.mjs enters the existing StemMusicDirector **4.5 seconds before each original recorded ending** using its normal resume offset, then lets its real preloading, clock and buffer-source scheduling advance to the next original song. It observes real WebAudio buffer-source calls for original drums, bass, guitar, piano, other and vocals. **All 33 outgoing-to-next handoffs passed**, including last-to-first catalog wrap; the largest original source start/end deviation was **0.022676 milliseconds**, with zero song-clock drift. The harness requires an absolute gap/overlap below **20 ms**, tightened from 200 ms.

This is genuine live source scheduling **near the end**, not hours of uninterrupted song playback or calibrated final device output.

## Independent OGG source, frame and SHA-256 verification

The companion browser-and-disk verifier tools/music/verify-real-song-handoff-sources.mjs checks the exact original first/last segments on both sides of all 33 boundaries. It fetched 396 unique original OGGs in Chromium, hashed their encoded bytes using browser crypto, decoded at 48 kHz, and verified **396/396 exact expected decoded segment frame counts**. It then read the 396 canonical original files directly from the private owner's archive, independently checked SHA-256 and encoded byte length, verified the manifest/role/segment identity, and matched the real game scheduler's 33 source-pair reports.

**All 33 handoffs and 396 SHA-256 file/decoded-frame checks passed.** Original private OGGs were not altered or uploaded. Immutable private aggregate SHA-256: **b817176d935b6ab3b91505dbd9f802599b832b1880359254eaaedcf2d04857bb**. An earlier immutable frame-and-hash-only aggregate SHA-256 was **21341b46adf23dd6399c913c21d7918a1579297698f4603ad7d653378862487c**.

An initial verifier failure was a **test-only JavaScript bug**: decodeAudioData detaches the passed ArrayBuffer, so reading its encoded byteLength after decoding was zero. The fix retains the original byte length and decodes a copy. An explicit **negative provenance control** then deliberately corrupted one digest *in memory only* and correctly failed closed against the untouched disk original. Earlier failed reports remain private, immutable and correctly labeled.

## Quiet original endings: candidates for the loopable-audio listening pass

At each genuine ending the verifier calculates an **unmixed** root-sum-square proxy across the six original stems for the preceding half-second and final half-second. This is not actual mixed PCM, mastered loudness, and cannot decide whether a fade is intentional.

**15 of 33 endings** lost over 80% of their original-stem RMS energy in the final half-second relative to the preceding half-second: catalog indexes **0, 2, 6, 7, 10, 11, 12, 16, 17, 20, 21, 24, 25, 29, 31**. Some other endings (4, 5, 18, 28) already have nearly silent final windows but start fading earlier, so this ratio alone does not flag them. The measured source tail can make an exact-clock handoff *feel* like a gap: it is not necessarily a decoder or scheduler error.

**Do not automatically amplify, delete, truncate or rewrite the original stereo recordings.** Hearing each candidate and, if desired, A/B testing a gentle early next-song transition belong in a **separate experimental, owner-reviewed music change**. Music downbeats and beat authority must not be invented.

## Owner-only reproducibility and boundaries

Start the private original-media overlay on numeric loopback only, using BSB291_PRIVATE_AUDIO_ROOT and BSB291_HOST=127.0.0.1, then run:

    GAME_URL=http://127.0.0.1:8221 QA_START_INDEX=32 QA_COUNT=1 QA_END_LEAD_SECONDS=4.5 REPORT_OUT=/private/unique-wrap.json node tools/music/audit-genuine-song-handoffs.mjs

With the four original 33-track scheduler batch reports and private catalog available:

    GAME_URL=http://127.0.0.1:8221 BSB291_PRIVATE_AUDIO_ROOT=/private/catalog REPORT_ROOT=/private/reports REPORT_OUT=/private/unique-sources.json node tools/music/verify-real-song-handoff-sources.mjs

For a **read-only source provenance negative test**, set QA_INJECT_BAD_ORIGINAL_SHA=1 with a new output filename and require it to FAIL. No original file, browser audio or media is committed to GitHub.

**Still open:** real-time quantum-v2 final-master capture reliability, full uninterrupted songs and intra-song segment transitions, sound-level listening, independent calibrated true peak/loudness, performance and source rights. Keep issue #291 open and PR #310 draft.
