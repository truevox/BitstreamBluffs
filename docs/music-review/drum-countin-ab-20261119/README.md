# *One More Run* — three four-beat drum-count-in auditions

**Music Friday / November 19, 2026 · listening prototypes only — NOT merged, deployed, or wired into the game.**

Marvin suggested that we listen to **all three approaches** before picking the most natural four-beat comeback. These are genuine rendered previews made from the original *One More Run* OGG stem pack plus one new editable MIDI drum performance. The files are deliberately short: **5.755 seconds** of the same song and the same musical context.

## 🎧 Listen — one at a time

1. **[A — Let the original drums play naturally](./A_original-natural-drum-stem.mp3)**. The game's actual drum stem continues unmodified while other instruments are gated out. This sounds most faithful to the recording, but depending on where death occurs it may play a fill, a rest, or more than four strikes.
2. **[B — Recorded MIDI drum-performance option](./B_recorded-midi-drum-kit.mp3)**. A newly authored/recorded 160 BPM MIDI note performance plays four accented quarter-note beats with some quiet hi-hat/ghost-note details. It's rendered through a small **original synthetic** kick/snare/hat kit, NOT transcribed from the existing stem, and NOT a live-recorded acoustic drum kit. **[Edit the MIDI take](./B_recorded-midi-drum-performance_160bpm.mid)** in any DAW using your preferred drum kit.
3. **[C — Four distinct hits from the original drums](./C_four-varied-original-drum-hits.mp3)**. Four different ~190-ms onset excerpts are borrowed from the already-owned original drum stem and sequenced at the common test times. Unlike the current game implementation, it does **not** repeat the exact same 140-ms source slice four times.

For the easiest side-by-side playback, download this folder and open **[the local listening comparison page](./index.html)**, which has one audio player per choice.

### Test controls and limits

All three clips have the **same original six-role band prelude and return**, same source playback clock and recording, **160 BPM** test grid (375 milliseconds per beat), **two silent beats**, and the same overall drum RMS level during the 1.5-second count-in. Common context: the original song from **1:01.800** onward, with simulated fatal crash at clip **0.900 seconds**, beat audition from clip **1.855–3.355 seconds**, and full band return at **3.355 seconds**. The 205-ms scratch is **deliberately omitted** in all three to isolate the drum-comeback comparison; Marvin separately found the existing scratch unconvincing, and that sound remains a distinct redesign project.

**Important:** The original Suno prompt explicitly requests 160 BPM, but this audition's 375-ms intervals and chosen source phase are **research approximations**, not a reviewed beat-position grid. Nothing about these clips approves exact OGG onset alignment, the production crash sound, or Gym timing. No original stem files or game soundtrack were modified. The MIDI file describes events, not an acoustic live recording.

The high/low frequencies and attack character of B differ from A/C because B intentionally uses a different synthesized drum kit; that's exactly what the listening test should reveal. Avoid interpreting the digital kit as the only way to render the MIDI—a good sampled live-drum kit could sound very different.

**What to tell Music Friday:** Which of A, B, C feels most like Maxi's band, and whether a hybrid using natural drums with varied fills on missing beats would be better. There's no wrong answer here, and the audition shouldn't change gameplay or music settings until you select a direction.

**Provenance:** original track pack `33_local-one-more-run-bitstream-bluffs` (segment 5, 48 kHz; original stem samples untouched). The comparison renderer is `tools/music/render_three_drums_comparison.py` on this feature branch. Source hashes and sample settings are in [`metadata.json`](./metadata.json).
