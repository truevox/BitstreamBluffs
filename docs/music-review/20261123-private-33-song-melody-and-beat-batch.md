# Bitstream Bluffs — private 33-song melody-only expansion and source beat research

**Owner request November 23, 2026:** Retain original six separated stems, do **not** replace drums/bass/guitar/piano/other with synthesized MIDI orchestra tracks, generate new full-length **biome melody voices** for all 33 songs and add all 33 to the game. Concurrently, map *candidate* source rhythm / beats for all 33 originals. Source recordings must remain unchanged; user listening/approved Pyramid lead must not be overwritten.

## Method recovered from prior sessions and source code

- CT211 canonical read-only source bank: `/root/bitstream-maxi/launch33/`, 33 manifest tracks, 32 Demucs six-stem songs + *One More Run* with original 11 stems and a previously reviewed grouped-six derivative. **Do not copy or alter originals**.
- Original four native gameplay tracks (Pope Leo, One More Run, Every Hacker, Varmont) already have their own approved/pending-review melodies. Preserve their source packs and melody voices byte-for-byte. Only 29 additional songs require first-generation leads.
- Use original separated **vocals** for YIN extraction (16kHz source audio / 10ms hop, note stability+silence filtering). Source-derived MIDI-like note events are an **unverified approximation**, not a trusted sheet-music score or artist MIDI; we do **not** use MIDI-generated backing stems. The renderer reuses the model-free, existing character instruments from `render_full_dynamic_orchestra_v1.py` / `render_biome_orchestras_v2.py` for eleven nonhome identities and the separately rendered home melody.
- Produce exactly the original six stems plus **12 distinct `voice:<biome>` melody buses** at 48kHz stereo; 12-second source-aligned Opus segments, each encoded with its own independent encoder and checked by full decoded frame count. Prevent partial publication by staging each song and promoting only after exact-frame checks. Existing four OGG original+voice archives are reused, not regenerated.
- CT211 melody output, PRIVATE ONLY: `/root/bitstream-maxi/launch33-melody33-20261123-private`. Source compilation/runner under `/root/bitstream-maxi/melody33-tools-20261123/`. Per-song audit JSON contains source vocal SHA-256, note events, extraction algorithm and provisional label; **not** published in game source.
- Source-drum/bass beat candidates use *different input tracks* from the melody model: real original FLACs. Two librosa beat tracking tempo priors 105/165 BPM; 18s local rhythmic autocorrelation every 6s; full-track source-frame 48k positions; four competing hypothetical 4-beat meter offsets per candidate, never one assumed true downbeat. Every source FLAC's SHA-256 is recorded and independently verified by `verify_33_original_beats.py`. **No asserted real tempo, quarter-note beat 1, meter, half-time section or drift; separate synthetic Gym beat API remains unchanged.** This honors the failed-closed real-source research already in DRAFT PR #53. Album-wide beat candidates must **never** flow into `RELEASE_BEAT_GRIDS`, game physics, Gym, World Dance, or master recordings without explicit verification.
- Private beat output: `/root/bitstream-maxi/launch33-beat-candidates-20261123-private`, with 33 separate immutable candidate reports, SHA-bound independent `source-verified-summary.json` and 66 verified original source FLACs. **Nine of 33 songs exhibit >15 BPM divergence between differing estimator start-priors**, often half/double-time ambiguity. This is a warning, not an artist-measured tempo discrepancy.

## Game integration

- The entire 33-song roster is represented by `FullSongRoster.js`; the old four song IDs/order are unchanged as the first four settings keys. The remaining 29 follow master slot sequence. On first install, all songs with actual media are enabled; saved legacy **all-four-off** selection migrates to 33-off rather than unexpectedly starting new tracks.
- Menu height cannot fit 33 toggles. The `MANAGE SOUND` panel now offers **SELECT TRACKS (33)** and a five-page, eight-toggle-per-page browser for keyboard, touch and gamepad. No new large spritesheets or media artwork are required to test the gameplay integration.
- `BeatGridCatalog.js` now lists all 33 as **UNVERIFIED**, not as certified source-downbeats.
- `assemble_private_33_song_game_catalog.py` assembles a private runtime catalog using symlinks to existing four full source/voice packs and new model-free 29, with complete 18-role/segment/clock validation. It only emits into a new PRIVATE game site media tree, refuses overwrites and disallows release with missing songs unless explicit `--partial` engineering smoke.
- No private OGG/WAV/FLAC or source-vocal-derived score JSON is checked into Git or shipped to public Netlify. The game code/roster and private deployment are independent: without installed media, the runtime retains the normal safe fallback.

## Verification already performed

- Remote CT211 slot02, *TRUNCATE TABLE: THE NINE-MILLION-ROW PURGE*: 687 provisional melody notes, 21 sample-exact segments, all 12 biomes / 252 synthesized melody OGGs, plus 126 original-core OGGs. Full source-derived song duration **249.77 seconds**, promoted atomically after exact decoded-PCM frame checks.
- Entire 33-song drum/bass beat batch completed successfully; independent source validation **33/33**, **66 original drum/bass SHA-256 matches**, all candidate timestamps monotonically increasing and inside original song boundaries; nine source songs have 15+ BPM disagreement between tempo priors. No musical downbeat approved.
- Five-song private real-game smoke (four existing originals + new slot02) validated full game boot, all 33 setting keys, selector pages `[8,8,8,8,1]`, switch/toggle restoration, **actual new 249.77-second Opus source song playback**, 18 bus identities / 12 melody voices, 21 real decoded source OGG requests, **zero unexpected HTTP failures or page exceptions**. A known older `debumont` physical-path 404 is resolved by existing explicit legacy fallback and counted separately, not misrepresented as a missing playable file.
- Focused Jest song-selection, jukebox continuity, shuffle, source beat release gates: **32/32 passed**. Vite build succeeded. Note these tests do NOT establish whether the automatically transcribed melodies sound right.

## Full-batch completion — source-verified private deliverable

The complete **29-new-song generator batch finished 28/28 parallel jobs successful, plus the separate pilot**, with no new-song failures. Independent verification from the *original* private FLAC source archive completed as follows:

| Check | Independently verified result |
|---|---:|
| Brand-new songs with melodic voice packs | **29/29** |
| Previously established, unmodified source-and-melody packs | **4** |
| New automatic YIN-derived note candidates | **19,978** (*unverified*) |
| New `voice:<biome>` melody Opus chunks | **6,564** |
| Source FLAC originals SHA-256 verified | **174** |
| New source+melody media references validated | **9,846** |
| Early and late representative melody Opus files independently decoded for exact frames | **290** |
| Final private game catalog songs | **33/33** |
| Total final catalog original+melody audio chunks | **11,016** |
| Missing media catalogs | **0** |
| Beat-candidate songs source-verified | **33/33**, 66 source original drums/bass FLAC SHA-256s |

The independent all-new-song validator on CT211 writes **`/root/bitstream-maxi/launch33-melody33-20261123-private/source-verified-all-29-summary.json`**, SHA-256 **`2d2eaf878f9e495e8647f7ed286d66603bb82da696464a0b44966720781f8b32`**. It explicitly states `releaseApproval: NONE`. The all-33 source-beat summary SHA-256 is **`0355ecdd85e08eb175f7cb20855c59e8ea4ac5483247e961b86741afb3b05155`**. **Do not copy these private detailed source/score audits or original audio assets into public Git.**

The private full-game catalog lives under `/home/hermes/experiments/bitstream-melody33-private-20261123/game33-music-final/` on CT223 and is mounted into the **private Tailscale preview** at `http://100.115.120.66:8213/`; source audio is not embedded in the public repository. The beat-candidate human listening page is `http://100.115.120.66:8213/music-review/beat33/`.

Three real Chromium game smoke trials on the **full 33-song catalog** succeeded for the pilot `ehy7VzQezYA`, the Factorio-themed final `cjphToi1DUo` and another new song `riwvGZ_dG30`. In all three: 33 selection keys, all five selector pages `[8,8,8,8,1]`, song toggle and restoration, 18 source roles including twelve distinct biome melody voices, and successful source Opus playback with positive live audio nodes. All had **zero unexpected HTTP errors and zero page errors**. A known older `debutmont` source filename fallback generates a test-observed 404 before the compatible original `debumont` path is loaded; this was not misclassified as a missing playable clip. These checks **do not** claim human audition or full-song transition testing on each of 33 tracks.

## Remaining gates before any general music release

1. Owner/independent **listening of the 29 newly generated source-melody transcriptions**, particularly voice octave errors, sustained vs repeated notes, rap/whisper/scream material, and missing or false melodic-note hypotheses. YIN output is not artist-proven MIDI.
2. Broader real-game continuous playback: all 33 songs in sequence/shuffle, actual segment transitions, low-end platform behavior and full-song audio peak/loudness QA. Three named-song starts and completed music catalog validation are **not** continuous 33-song performance certification.
3. Confirm actual beat-one, meter, downbeat phase, half-/double-time interpretation, tempo changes and sections from the original recordings. All 33 candidate maps exist, but **none** is certified for Gym/World Dance/game physics.
4. Source media licensing/publication checks and final mastering approval before releasing any private copyrighted OGG/FLAC/WAV to public Netlify or a player download. Keep all new media private until authorized.


## Private beat-map listening lab (not an approval authority)

A source-identity-bound static page at `public/music-review/beat33/` reads the installed private `/music/catalog.json`, the genuine six OGG stem clips for a chosen original source section, and matching `data/<slot>_<id>.json` private machine-beat reports. It offers **two alternate pulse tempo priors** and **four possible 4-pulse bar-accent offsets**, plays non-authoritative synthetic click sounds on the original six stems, and exports source-specific human observation notes locally without changing game timing or settings. It never calls the `RELEASE_BEAT_GRIDS` production gate. The private data files must be provisioned by the owner-authorized archive at runtime, not committed to public code. The page refuses a mismatched candidate report song identity.

Five-song private Chromium proof: the page loaded a real original six-stem source excerpt plus candidate clicks; selected beat prior and accent; exported JSON; zero unexpected HTTP/page errors. Deliberately replacing the source report's `trackId` with an unrelated ID caused the page to **reject the source**. Browser test: `tools/music/smoke-beat33-source-review.mjs`.
