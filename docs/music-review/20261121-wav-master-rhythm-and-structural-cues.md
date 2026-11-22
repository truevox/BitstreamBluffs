# *One More Run* — verified lossless master WAV, rhythmic cross-check and targeted section cues

**2026-11-21 EST · Music Friday · source-bound research in [DRAFT PR #53](https://github.com/truevox/BitstreamBluffs/pull/53) · NO approved beat one, quarter-note grid, actual fixed/drifting tempo, meter, phrase or bridge.**

## 1. Verified original master, not merely the MP3 copy

We directly read the historical original musical master on **CT211** (`ollama`, reachable via authorized SSH from CT223) at `/root/bitstream-maxi/launch33/audio/33_one_more_run.wav`. Direct original-file `sha256sum` **exactly matched** the archived record:

`636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721`

Direct FFprobe confirmed `wav` `pcm_s16le`, **48,000 Hz, stereo, exactly 174.6 seconds**, i.e. **8,380,800 original source frames**. The original WAV was **not copied to Git, into a worktree, into a local media file, into an app build, onto Netlify, or changed**. A fresh SSH pipeline remotely decoded the WAV to an 11,025Hz mono floating-point stream read **in memory** for analysis only; original source PCM remained unchanged. No MP3, original stems, 11-to-six grouping or game soundtrack sources were modified.

The previously archived original MP3 at CT223 `/home/hermes/worktrees/bitstream-adaptive-music-20261115/public/music-transcription-audition/one-more-run-original.mp3` was also independently SHA-verified (`931402316385f7a1afd302d59132b812f0ae6a312b46b8cd85826c0a63906a8e`) and decoded only in memory.

**Lossless master versus preserved MP3:** at opening 0–12s, middle 84–96s, and ending 168–174.6s, the highest normalized PCM correlation was **0.99911 / 0.99839 / 0.99915** respectively at **zero analysis-sample lag in every excerpt**. Their audible recording and original timeline are effectively the same source for these purposes; this is **not** an assertion of codec-identical PCM or a new artist-approved tempo.

## 2. Master WAV rhythmic-frequency evidence

Using the source WAV's own high-band (230–4,700Hz) positive log spectral-flux representation, analyzed in the same source-clock 28 overlapping 18s windows (6s hop), the master preferred a rhythmic period with median **163.8098 BPM**, range **163.1887–164.2365 BPM**. The equivalent independently decoded original **MP3** analysis has median **163.8092 BPM**. Their preferred periodicity proxies differ by only **0.00764 BPM mean absolute difference** and **0.0279 BPM maximum absolute difference** across all 28 corresponding overlapping windows. This corroborates the rhythmic-frequency *feature*, not a musical quarter-note grid. The source WAV's full-song frequency preference is **163.85 BPM**, relative rhythmic-onset phasor coherence **0.105241** (weak), almost identical to the preserved MP3's **163.85 BPM** / **0.105246**. The original separated drums previously gave **163.80 BPM** but modest global phase concentration ~0.241.

The extremely small differences between WAV and MP3 come from their being **the same recording** rather than independent musical performances. Their high-frequency feature extraction validates codec consistency, not tempo steadiness. Weak whole-song phasor concentration means the individual rhythmic accent events **do not lock cleanly to one global fixed phase**, but instrumentation, syncopation, chord attacks, changes in arrangement and genuine slight drift remain possible explanations. The earlier very different bass-only ~130 BPM local hits are **not independently reproduced**. No real beat-one, time signature, source half-time bridge, or local tempo changes have been proved.

## 3. Candidate musical structure, not labels

An additional **source master only**, full-song chroma/pitch-class novelty and neighborhood loudness-change detector identifies candidate *harmonic or energy transitions*. It does **not** use preset musical bars to discover section times. It is deliberately *not* calling these an intro, chorus, verse, break, half-time bridge or phrase boundary. Strong original-source novelty candidates include:

| Master source time | Evidence interpretation |
|---:|---|
| **45.73 s** | Relatively prominent pitch-class / energy change; needs ear review |
| **121.84 s** | Harmonic novelty within earlier 120–132s disputed phase region |
| **146.78 s** | Later musical transition candidate |
| **167.13 s** | Strong late-song structural change, potentially close to ending |
| **172.23 s** | Additional high late-song chroma novelty; ending is only 174.6s |

These are **time hypotheses** only, not verified bridge entrances. Original harmonic novelty is normalized within the same song and several scores saturate the top of the scale: **the score is an arbitrary review ranking, not a calibrated probability**. The highest-scoring changes may be chord changes, musical fills, or instrumentation swaps rather than a new section. We also retain earlier disputed **78–102s** and **120–132s** passages as explicit historical review priorities, even though their original bass tempo interpretation did not hold under newer extraction methods.

## 4. Better focused browser listening, no media upload

The optional [original OGG listening lab](https://deploy-preview-53--bitstream-bluffs.netlify.app/music-review/downbeat-review/) now includes a **12-passage source-master-informed review shortlist**. In contrast to the old isolated 12-second playback, the lab plays the existing **original SHA-checked six game OGG stems** over any contiguous requested 9-second passage, **including original 12-second OGG segment boundaries**. The source WAV master is **not included in the preview**: its analysis report is only small, signed-by-hash research metadata. A passage spanning 45.73s now plays approximately **41.23–50.23s** by slicing original segment 3 then segment 4 at exact original source times, with no audio concatenation, copying, re-encoding, or tempo change. The existing hypothetical four-accent metronome remains continuous across that segment seam, with mathematically preserved original source timestamps and original four-way beat-one offsets, **not** musician-verified timing. User observations still remain local in the browser until exported as *unverified notes*; the page does not write to release data, shared files or the game.

The source metadata packet fails closed unless original pack manifest, source drum/bass/harmonic/global-phase/phase-motion reports, preserved MP3 original-mix report and exact source-WAV master report form one matched SHA-256 chain. The browser enforces the expected original master fingerprint and refuses any passage data marked verified. Every requested OGG file is SHA checked against original six-stem archive metadata before playback. The browser-smoke test now exercises a real two-segment 45.7s review audition, six-original-stem playback, click-offset switching and intentional OGG byte tampering with **no JS errors**.

## 5. Validation and next gated step

- New **six Python tests** verify PCM codec/clock validation (including negative alternatives), original WAV phrase heuristic on synthetic harmony/energy changes, prior uncertain passage retention, and source-report hashes/negative verified-status gates.
- New **three Node tests** check original WAV+MP3 report SHA chain and candidate-only shortlist, exact OGG source-segment slicing across original 12s cuts and missing-segment failure, and four-accent source-absolute click continuity when seeking and crossing cuts.
- Existing **65 research tests** + these **nine new** = **74 automated tests** (65 Python + 9 Node), all required to pass with the real-source Chromium smoke before any push. Synthetic tests verify code behavior **not musical truth**.

Machine-readable source evidence: `docs/music-review/one-more-run-verified-wav-master-structure-UNVERIFIED-20261121.json` SHA256 `2e41e73287bc2bb01b3d6c7dd1c15af9d841583da143a45c19ffcb7eaaaf225f`; source-exact verified master SHA above. Browser `candidates.json` now includes original master and original MP3 report checksums, along with only unapproved short review passages.

**Still not ready:** No true source bar-1 or beat-one, calibrated local tempo map, certified phrase boundaries or real bridge entrance/exit. Next useful work is targeted musical review and comparison of spectral/chroma source changes to independent meter/downbeat estimates, with explicit half-time ambiguity. **DRAFT PR #53 must remain research only**; original master, OGGs, synthetic cosmetic click API, music engine, `RELEASE_BEAT_GRIDS`, World Dance, Gym, physics and scorekeeping remain unchanged.

**Provenance:** Marvin asked Music Friday to pursue useful independent source research, and separately raised concern about Suno/Kie BPM instability. Source extraction methods, numeric results, queue, interpretations and constraints here are Music Friday's independent analysis, not Marvin's decisions or musical verification.
