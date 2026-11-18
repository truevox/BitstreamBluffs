# Music Gym — One More Run source-bound beat-grid cross-check

**2026-11-18 | Gal Friday engineering research | Unverified; not a release beat grid.**

Control Friday's Gym has a proven real-time 1,000 ms READY period and will accept at most 300 ms of optional music alignment, without ever allowing the soundtrack to own physics. Music Friday's previously published `AudioSynth.getBeatTiming()` interface already complies; **this follow-up only adds research, tests and a human review queue**. The committed release `BeatGridCatalog.js` remains unverified for every song. No game audio, shipping pulse metadata, gameplay, or Control branch changes were made.

## Provenance and scope

- Canonical original mix **`/root/bitstream-maxi/launch33/audio/33_one_more_run.wav`** on CT211, read-only via PVE `pct exec 211 -- ffmpeg`, streamed **mono, 11,025 Hz, 32-bit float PCM** to the local research process. No full WAV/FLAC copy, no source mutation. Original source SHA-256 **`636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721`**, verified using `sha256sum` on CT211. Original PCM 48,000 Hz, two channels, 174.6 seconds. This duration matches released `pack.json` (8,380,800 frames).
- **Shipped stem pack manifest SHA-256** `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`. All 15 source segments inspected. Original-stem OGG SHA-256 values are retained in the source-bound research reports. The human review queue fails closed on a pack manifest mismatch.
- **Previously published public interface:** feature `feature/music-gym-beat-grid-20261118` at implementation `5325f5b` and first research extension `09bb6a6`. Full calling contract: `docs/MUSIC-GYM-VERIFIED-BEAT-TIMING-20261118.md`.

## Three separate families of evidence

1. **Original drums and bass OGG stems.** `tools/music/research_gym_cross_stem_alignment.py` scans per-segment onset envelopes and full-recording Fourier power/phase. The strongest drum periodicity is **163.839 BPM**, the strongest bass periodicity **81.919 BPM**, approximately a **2:1 subdivision**. A third strong drum periodicity at **122.822 BPM** competes. At the chosen 2:1 relationship, only **6 of 9 sections with strong evidence in both stems** have beat-pattern onset phase differences within the machine-chosen 65 ms tolerance. This does **not** establish meter or quarter-note identity. A descriptive uniform-random phase reference would produce about 3.2 such alignments; this was computed *after examining candidates* and is **not a valid statistical significance test**.
2. **Actual original two-channel WAV, downmixed for independent source-onset analysis.** `tools/music/research_gym_original_mix_check.py` observes strongest original-mix onset patterns around **122.948, 204.810 and 163.954 BPM**, not simply the drum/bass top FFT periodicities. No one of these is established as the perceived quarter pulse. The source-waveform FFT can strongly reflect guitar, melody or vocal attacks, which are not a metrical beat ground truth.
3. **Different beat-induction algorithm on the original WAV.** `tools/music/research_gym_independent_beats.py` uses Librosa 1.0.1 median-aggregated spectral onset strength and dynamic-programming beat tracking. An 80 BPM initial prior yields approximately **80.750 BPM, 238 proposed pulses**; 120 and 160 BPM priors independently converge within the *same* algorithm to identical **161.499 BPM, 474 proposed pulses**. The slow candidate matches 208/238 fast-grid timestamps within 55 ms; conversely, 208/474 of the fast-grid timestamps match the slow. Again, this is **half/double-time evidence**, not independent metrical annotation. Multiple priors of one algorithm are not independent listeners or a validation ground truth. The estimated BPM may change locally; the repeated 161.499 local median on many segments is partly beat-frame quantization at 256 samples per hop.

The 161.499 BPM dynamic tracker average does not automatically agree in phase with the 163.839 BPM Fourier onset train. Simply extending either period from time zero across 174.6 seconds can drift far enough to release on the wrong subdivision. **No constant-BPM formula, onset peak, beat tracker output or Fourier phase has been written into the released beat catalog.**

## Balanced, falsification-oriented human review queue

`tools/music/build_gym_beat_review_queue.py` checks source ID, original WAV SHA, original length/sample rate and exact pack manifest bytes against the prior evidence. It then creates **15 complete research-only sections** and chooses **eight** short review windows distributed across the song, with both agreement and disagreement examples. It does not approve any beat.

| Original recording window | Purpose for independent reviewer | Two-stem harmonic phase |
|---|---|---|
| 0–12 s | Opening groove and initial source phase | 2:1 pattern aligned ~−10 ms |
| 12–24 s | Is this really the same half-time pulse? | Aligned ~−10 ms |
| 24–36 s | Weak-stem counterexample | Insufficient support |
| 60–72 s | Strong onset patterns disagree markedly | Disagree ~+172 ms |
| 72–84 s | Mid-song aligned counterpoint | Aligned ~+7 ms |
| 108–120 s | Strong evidence with nontrivial disagreement | Disagree ~+67 ms |
| 144–156 s | Late-song phase-drift check | Near tolerance ~−61 ms |
| 156–168 s | Late-song weak-stem counterexample | Insufficient support |

Each queued section contains exact original 48 kHz source-frame ranges, candidate beat-frame indices for reference, explicit uncertainty, reviewer prompts, and `approval:false`. The queue priority is a **review-workload heuristic, not confidence**. Review should independently mark regular perceived quarter-note anchors, not necessarily the loudest kick/snare, identify half-time subdivision, inspect whether meter/tempo legitimately changes, and compare distant anchors to detect cumulative drift. Where beat identity or phase is not defensible, the future section must be `uncertain` with **no authorized pulses**; the Gym releases after its ordinary 1,000 ms READY.

## Immutable research evidence, all **unverified**

- Cross-stem (all four songs): `/home/hermes/experiments/bitstream-gym-all-songs-cross-stem-alignment-v3-20261118.json` SHA-256 **`fb2062a121d05442afe5dd841f8745f0d0299a42f709e921c9c31001355fd885`**.
- Original *One More Run* WAV onset analysis: `/home/hermes/experiments/bitstream-gym-one-more-run-original-mix-crosscheck-20261118.json` SHA-256 **`3b88a74d4cbdc45a0107c10888091d65737a3b854d738c3b7959856950a3fff3`**.
- Original WAV dynamic tracker, 3 tempo priors: `/home/hermes/experiments/bitstream-gym-one-more-run-librosa-multiprior-20261118.json` SHA-256 **`862875e075694a6396af3018cfdc8c7f713e5c9ff94d1c6e6cde40347d1f03a4`**.
- Stratified human review queue: `/home/hermes/experiments/bitstream-gym-one-more-run-review-queue-stratified-20261118.json` SHA-256 **`badcdb955f0f86502bd81228a20d0fcc18179da677cba2bf4cbc464cd85c2a84`**.

Research scripts use existing Python numerical packages through `uv run --no-project --with numpy --with scipy` (and `--with librosa` for the different dynamic tracker), and streamed FFmpeg on the **remote original**. They refuse overwrites and do not generate replacement source tracks, shipping beat metadata, or audio for the user. Once the user can listen, the eight bounded windows provide a specific and efficient human-review protocol, rather than asking for a full 175-second manual transcription.

**Safety and release gates:** Source and model provenance are not equivalent to listening confirmation. No song has passed an accountable musical quarter-note review; no real beat timings can yet be served. Control Friday can integrate the API now, but its result for the released songs remains `{trusted:false,release:'immediate',reason:'unverified-beat-grid'}`. Cross-browser and full playback timing can be checked separately after real grids have independent musical verification. Control owns READY, the optional 300 ms timer, and exactly one GO per attempt.

## Follow-up: portable, timestamped visual evidence (2026-11-18)

The source-bound review has been made independently inspectable via
[`docs/music-review/README.md`](./music-review/README.md) and a self-contained
[8-window SVG HTML report](./music-review/one-more-run-timestamped-onsets-20261118.html).
It draws separate full original mix, drums and bass onset-energy lanes, and
three *distinct unverified* rhythmic pulse hypotheses (the 80.75 BPM and
161.50 BPM dynamic-programming prior paths, plus 163.839 BPM Fourier
onset-comb phase). Curves are normalized per window and are NOT comparable
loudness measurements. Original source hashes and every source segment frame
are checked, no audio is embedded, and the generator produced byte-identical
HTML on a second read-only WAV stream. All 15 segments remain **uncertain**.
Two independently human-completed review templates are required before even
a non-authoritative consensus candidate can be made. The consensus checker
is structurally separate from the runtime `bitstream-beat-grid-v1` schema;
tests confirm the real game validator rejects this research output. The
actual music/game implementation is unchanged.
