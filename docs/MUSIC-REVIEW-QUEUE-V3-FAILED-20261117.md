# Bitstream Bluffs — Drum V3 rejection and machine disagreement review queue

**2026-11-17 • Experimental engineering work, not musical approval.** The actual game's Music Lab can now navigate a reproducible shortlist of 20 high-disagreement real-song passages. This is **not a verified gold set, and none of these machine-ranked passages is a confirmed musical error**. All four released recordings and 4,745 Ogg segments remain unchanged.

## 1. Failed V3 anchored hybrid — preserve negative evidence

tools/music/detector_candidate_v3.py tests retaining release v1 broadband drum onset anchors, then merging V2 kick/snare/hat class candidates within 38 ms of those onsets. This permits co-hits but was expected to restrain false events.

tools/music/benchmark_drums_v3.py measured the four alternative methods against the exact same nine synthetic scenarios: isolated hits, kick/snare/hat co-hits, hat rolls, echoes, true quiet ghost snare and kick strikes, and 80/155 ms real restrikes.

| Mean F1 across nine synthetic cases, 20ms | Value |
|---|---:|
| Current released v1 | 0.5758 |
| V2 original ratio echo guard | 0.6294 |
| V2 without echo guard | 0.5847 |
| V3 anchored, no echo guard | 0.4879 |
| V3 anchored, ratio echo guard | 0.5489 |

**V3 is rejected for audio rendering.** It retains many original false positives while accepting additional spurious V2 events. These are synthetic fixture numbers, NOT actual-song performance or human verified music accuracy.

Exact evidence: CT211 /root/bitstream-maxi/detector-candidate-v2-20261117/v3-anchored-fusion-nine-cases.json. Original V1, V2, source FLAC, and game recordings remain untouched.

## 2. Model disagreements become future human-review navigation

The previous unlabelled audit produced 473 ranked eight-second song/role passages by a weighted pitch/class and ±50ms onset disagreement proxy. Its diversified 20-passage shortlist contains **Pope 3, One More Run 9, Runs Out of Code 3, Varmont 5**.

Canonical original comparison audit: CT223 /home/hermes/experiments/bitstream-candidate-v2-capture-20261117/model-disagreement-review-queue-v1.json; CT211 /root/bitstream-maxi/detector-candidate-v2-20261117/model-disagreement-review-queue-v1.json.

tools/music/build_review_queue_v1.py deterministically converts that existing 20-item shortlist to four tiny public/music/packs/<song>/review-queue-v1.json files (approximately 1–3 KB each). Each file preserves the real song's exact 48kHz frames, eight-second boundaries, source role, original globally ranked position, released and proposed event counts and the number that agree by pitch/class within 50ms. Every file declares machine-ranked-disagreement-not-human-verified and binds the exact released/candidate score hashes and song ID.

Each game pack now has a diagnosticReviewQueue pointer. MusicPack.js checks path and parent score/candidate hash, and MusicReviewQueue.js checks non-gold status, role, times, uniqueness, rank and legal counts. Neither the pointer nor the queue is a playable stem, a source selector, a renderer input, a gold label or a persistent account/profile field.

## 3. Actual game Music Lab — NEXT SUSPECT

Go to **Settings → Manage Sound → Music Lab → NOTES (N)**, then press **NEXT SUSPECT** at the right of the timeline.

Within the chosen song it rotates through machine-ranked disagreements. Each click chooses the affected instrument role, freezes the score timeline at the start of the eight-second passage, shows original V1 in cyan and unapproved V2 in pink, and seeks and isolates the real instrument role using the very same StemMusicDirector engine as gameplay (an isolated lab instance). It displays the global rank and original-versus-V2 counts, explicitly marked **unverified**.

The source score and prior draft correction export remain untouched. No generated note, V2/V3 performance, music settings, profile, gameplay progress or musical recording is modified by the review queue. The older standalone lab remains **SOUND DESIGN ONLY** per Marvin; transcript accuracy, timing and packaging are evaluated inside the actual game.

Review queues are loaded only after both original and V2 source hashes validate, with async generation guards. Invalid data disables the feature without stopping music, and a late queue from song A cannot overwrite B.

## 4. Evidence, limits and next steps

- Real Chromium: all 20 source-pinned passage jumps and wraparound in four songs; instrument choice and real music engine seek; unchanged settings/profiles; corrupted file rejected while music continues; delayed A response cannot contaminate B.
- Source tests: tests/src/music-review-queue.test.js verifies quality, provenance, legal bounds, roles and counts.
- Release gate: tools/music/validate_performance_release.py confirms 4,745/4,745 original Ogg SHA256 values unchanged, 33,752 original-release score events, four score V2 parent/source hashes, identical audio-manifest controls, and precisely 20 unverified review passages.
- Deterministic generation reproduces all four tiny JSON queue outputs byte-for-byte.

**Still blocked:** verified quiet ghost-note detection and real musical pitch/onset labels, calibrated confidence, gold metrics on source music, and approved replacement recordings. The new reviewer workflow prepares for later owner listening; it is **not** a request for Marvin to listen now.
