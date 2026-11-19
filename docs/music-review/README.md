# Music Friday — Listening room and design notes

These files are for **audition and research**, not new in-game sound settings. The public Bitstream Bluffs game continues to use the previously integrated soundtrack, vinyl effect and original four-hit crash recovery. Nothing in this folder changes game audio or source asset packs.

## 🎧 Playable *One More Run* drum-comeback comparisons

Marvin requested three different four-beat versions before deciding what sounds most natural. All three use the same approximately 5.8-second original-song passage, identical band drop-and-return, and a provisional **160 BPM** spacing taken from Maxi's original Suno style prompt (not a source-verified beat grid).

**Easiest route:** [Download the three-comparison listening ZIP](drum-countin-ab-20261119/OneMoreRun_ThreeDrumCountins_160bpm.zip) from GitHub using **Download raw**, unzip it, and open its `index.html` on a computer or in a browser that can play local MP3 files.

- **[A — Natural original drum stem](drum-countin-ab-20261119/A_original-natural-drum-stem.mp3):** The original drums keep playing while the rest of the band drops out.
- **[B — Newly authored MIDI drum performance](drum-countin-ab-20261119/B_recorded-midi-drum-kit.mp3):** An editable new MIDI count-in rendered through a basic electronic kit, *not* a transcript of the original stem. [Download MIDI](drum-countin-ab-20261119/B_recorded-midi-drum-performance_160bpm.mid).
- **[C — Four different original drum hits](drum-countin-ab-20261119/C_four-varied-original-drum-hits.mp3):** Four separate original-source attacks, removing the repeated-identical-hit sound of the current effect.

The existing synthetic scratch is deliberately **not included** in the comparisons so only the drum treatment changes. The three preview MP3s have been rendered, reproduction hash-checked, and tested for playback in Chromium. They are not currently available as an in-game A/B/C switch. Full [method and source notes](drum-countin-ab-20261119/README.md) and [preview metadata](drum-countin-ab-20261119/metadata.json) are retained.

## 🛠️ Designs, not playable audio

- [Realistic scratch and original-drum hybrid design](20261119-realistic-scratch-and-four-beat-arrangement-design.md): how to replace today's filtered-noise imitation with a real original-music platter-scrub, plus the possibility of mixing a naturally continuous drum stem with selective distinct accents. **No new scratch recording has been generated.**
- [Piano-friendly, lightly quantized melody design](20261119-piano-friendly-quantized-melody-design.md): an optional future interpretation of Maxi's melody with simplified pitch ornamentation and slight timing quantization. Preserve meaningful vocal/scream glides, remove incidental note-tail scoops. **This is fact-finding only—there is no playable version yet, and no approval to implement it.**

## Access and safeguards

These links work directly from the GitHub **`main`** repository once the documentation-only PR has merged. GitHub renders Markdown, but typically does not execute a committed `index.html` as an interactive webpage; use the ZIP for the offline three-player listening room. The code reproducing the previews is at [`tools/music/render_three_drums_comparison.py`](../../tools/music/render_three_drums_comparison.py) and needs full original OGG assets plus its declared offline dependencies to execute.

**No `src/`, production music files, scores, beat catalog, runtime settings, Netlify application files, or gameplay code are modified** by this review package. Publishing these assets to `main` does not make the future quantized melody an active or selectable soundtrack. Owner listening approval is still required before any sound replacement.
