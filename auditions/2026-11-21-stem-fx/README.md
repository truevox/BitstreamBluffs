# Biome stem-processing A/B audition — 2026-11-21

This is an isolated experiment, **not** a game integration or a new canonical mix.

Song: **Pope Leo Wants the AI Root Password** (FEsxYVStla4). A roughly 20-second window from existing separated stems (chunks 0003 and 0004); the same exact six recorded performances in all four clips.

1. [Unprocessed stem reference](./00-stems-unprocessed-reference.mp3)
2. [Debumont: Snow Blanket](./01-debumont-snow-blanket.mp3) — doubled low-pass on nearly everything, especially drums and cymbals, with minimal dark echo.
3. [Garbage Dump Glacier: Industrial](./02-garbage-industrial.mp3) — saturation/soft clipping, metallic slap delays, gritty sample resolution.
4. [Arcade: Digital](./03-arcade-digital.mp3) — bitcrushing, tremolo and phasing on selected instrument stems.

All four use the same six **original stems** (vocals, drums, bass, guitar, piano, other) with per-stem effects and matched approximate integrated loudness. Vocals are currently the existing isolated audio stem, **not** a newly transcribed MIDI rendition. This audition does not test biome MIDI vocals, real-time AudioWorklet performance, source separation accuracy, or a live cross-biome blend.

The source recordings and all existing stems were left unchanged. Effect settings and gain levels are recorded in [audition.json](./audition.json).

The Debumont version intentionally removes considerable high-frequency information. Its filtered energy above 2.5 kHz measures roughly 14 dB below the baseline, in this 20-second sample. This is one aesthetic option, not a locked final mix.
