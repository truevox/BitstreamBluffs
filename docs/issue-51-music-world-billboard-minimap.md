# Issue #51 — Music-reactive billboards, downbeat scenery, and adaptive minimap

Owner brief: https://github.com/truevox/BitstreamBluffs/issues/51

**Development protocol:** issue first, then draft PR, then implementation and tests. This file is a design-only PR bootstrap, not a completed feature.

The game world should show a *real YouTube thumbnail* billboard once per song change, passing the camera at a screen-visible height without hiding the racer; a gentle spotlight follows it. No redundant toast. A local-only track needs a truthful fallback.

World Dance should combine original OGG mix intensity/transients with small synthetic beat accents and stronger artificial downbeat accents from `AudioSynth.getSyntheticMeterTiming()`. Beat/downbeat boundaries must be edge-triggered on transport revision and index changes. The grid is unverified and cosmetic-only, never authoritative for physics or scoring. On pause/mute/fatal recovery, dancing should cease, without freezing core gameplay.

A small terrain-aware minimap should be top-right when the rider is bottom-left, otherwise bottom-left; it must not conceal other UI or imply globally known offscreen locations. Reduce Motion and World Dance OFF should suppress ornamental movement but not hide useful static information.

Music Friday owns real beat/phase research and YouTube source associations; CC Friday can review UI and title-overhaul overlap. Implement via separate modules; review with real browser smoke; do not merge without checks.

## First implementation — in draft PR #52 (engineering, not a new owner decree)

### Song thumbnail billboards

The three public YouTube-song IDs already present in the **canonical shipped soundtrack catalog** have local bundled 320×180 JPEGs fetched once from YouTube's thumbnail CDN and saved under `public/music/thumbnails/`. The original screenshots are not altered to create AI-imagined artwork:

- `FEsxYVStla4` → `https://i.ytimg.com/vi/FEsxYVStla4/mqdefault.jpg`
- `WRBGQUqD54U` → `https://i.ytimg.com/vi/WRBGQUqD54U/mqdefault.jpg`
- `FYImnz5-hXs` → `https://i.ytimg.com/vi/FYImnz5-hXs/mqdefault.jpg`

`local-one-more-run-bitstream-bluffs` presently has no **catalog-confirmed** YouTube association and therefore gets a truthful local fallback. Music Friday has been asked on issue #51 to confirm any official video association. The source ID belongs to the track, not an arbitrary internet search match. Preload fetches these bundled files; **no YouTube call occurs at runtime or per frame**. A failed thumbnail falls back to the readable sign.

The song-change event comes from the continuously running soundtrack's `onTrackStarted` hook. The game never restarts music just to display a sign. The RunScene billboard is a shallow, decorative layer behind terrain, hazards and the rider: a metal frame, song name, honest cover image and subtle spotlight. It scrolls from the right via a combination of real camera travel and gentle minimum pass speed, and uses the actual terrain silhouette to keep its bottom above the ground so it remains visible. Repeat entry/retry of the exact *same* currently playing song is deduplicated for the lifetime of the shared AudioSynth. The old full-width song-change toast is removed, while unrelated run/achievement/biome notifications remain intact.

### Cosmetic-only beat/downbeat treatment

`WorldDanceEnvelope.update` now accepts an OPTIONAL `AudioSynth.getSyntheticMeterTiming()` snapshot alongside the original, *real* WebAudio mix energy sample. Synthetic beat-index and measure-index changes trigger once per edge; beat 1 of a **new synthetic measure** produces a larger accent. The visible meter component is gated by the actual audible mix energy; no soundtrack means no rhythmic pulses. It cannot touch the validated Gym beat gate, collision, physics, scoring, transport, count-in or recording provenance. Every public song grid remains marked **unverified** and the arbitrary 0.5-second pulse / 4-beat measure is never promoted to real musical timing. Music Friday owns source-aligned beat/downbeat research.

### Rider-avoiding minimap

A tiny 104×49px drawing in UIScene samples the same deterministic `TerrainGenerator.heightAt` as the physical world, roughly 150px behind and 550px ahead. It plots terrain shape and a rider marker; it does **not** claim hazard discovery or hidden offscreen items. Its screen-space layout flips to top-right whenever the player occupies the bottom-left quadrant, otherwise bottom-left, leaving the centre of the race unobstructed. It is read-only, uses only ~27 samples at approximately 9Hz, and does not update physical world state.

### Accessibility and limitations

The World Dance ON/OFF and Reduce Motion Auto/On/Off settings already shipped in PR #38 govern the rhythmic animation, including the billboard squash. Under silence, manual pause, fatal-count-in or muted music the mixer and synthetic meter return null and the dance envelope resets. The billboard and minimap are informative static objects even with reduced-motion preference. No new controls or changes to the title-screen overhaul are part of the implementation.

**Honest prototype boundaries:** The billboard is decorative rather than a physically collidable sign; its scroll speed is not a literal vehicle-world-speed conversion. The local song's fallback is intentionally not claimed to be YouTube art. The minimap is local terrain only, not a gameplay radar or world map. The synthetic downbeat is a provisional visual cue, not a recognized beat in the recording. Gameplay balance/physics remain unchanged.
