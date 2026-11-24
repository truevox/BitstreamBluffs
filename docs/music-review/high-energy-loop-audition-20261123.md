# Private audition loops that stay musically energetic

**Experimental source-stem listening previews, not a change to gameplay music or originals.**

The older audition excerpts were chosen from the first 12 seconds of each song, and their volume envelopes made comparative listening frustrating: *One More Run* started in near silence and fell dramatically in its last second; *Pope Leo Wants the AI Root Password* spent its first several seconds nearly silent. These were real source-dynamics changes, not a DSP fault.

Measured the synchronized original five-stem mix across every 12-second segment of both songs in 1-second RMS windows. Selected:

- **One More Run:** segment `0011` (steady, relatively loud throughout; raw last 3 seconds average about 96% of mean).
- **Pope Leo:** segment `0014` (steady/building throughout; raw last 3 seconds average about 129% of mean).

`tools/music/generate-high-energy-audition-loops.py` decodes all five **original stereo** instrumental stems for each chosen segment, uses an approximately 750-ms source-head/source-tail crossfade (its exact length is optimized within 680–820 ms to avoid a steep waveform join) applied identically in time to every stem, and generates separate stereo Opus OGG previews (plus one coherent five-stem mix for the older Snowpack page). This makes playback an approximately 11.25-second loop with no long fade-out, while the original source archive and separate gameplay audio remain unchanged. The browser loops these previews indefinitely. The crossfade might still be heard as a *musical phrase seam* where bars do not line up perfectly; listening approval is needed.

Generate after Vite build on CT223, before serving `dist/`:

```bash
npm run build
python3 tools/music/generate-high-energy-audition-loops.py dist/audition-loops
python3 tools/music/verify-high-energy-audition-loops.py dist/audition-loops
```

The private preview is hosted at `http://100.115.120.66:8212/listen-today.html`. Source packs reside in the private original-music archive; the generator checks source existence, records SHA-256 provenance in `manifest.json`, and refuses to target the source archive for output. **Do not commit generated original-stem excerpt binaries to public GitHub or treat this as a permanent production/Netlify asset pipeline.** Generated files will require regeneration whenever Vite cleans `dist/`.

Validation: live Chromium source loading/playback/Extra-slider smoke in all 13 pages; **13/13 PASS, 0 HTTP errors**. Independently decoding both five-stem previews, RMS measurements show a minimum one-second level of **75.8%** of its preview average on *One More Run* and **76.3%** on *Pope Leo*. The final two seconds retain **96.0%** of average energy on *One More Run* and **131.7%** on *Pope Leo*. An extra seam check now verifies that the join-to-first-sample waveform step is less than 3× the average adjacent step (observed: 1.34× and 0.38×, respectively). (These are energy-envelope measurements, not listening or mastering approval.)
