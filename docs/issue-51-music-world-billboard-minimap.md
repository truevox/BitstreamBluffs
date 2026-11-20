# Issue #51 — Music-reactive billboards, downbeat scenery, and adaptive minimap

Owner brief: https://github.com/truevox/BitstreamBluffs/issues/51

**Development protocol:** issue first, then draft PR, then implementation and tests. This file is a design-only PR bootstrap, not a completed feature.

The game world should show a *real YouTube thumbnail* billboard once per song change, passing the camera at a screen-visible height without hiding the racer; a gentle spotlight follows it. No redundant toast. A local-only track needs a truthful fallback.

World Dance should combine original OGG mix intensity/transients with small synthetic beat accents and stronger artificial downbeat accents from `AudioSynth.getSyntheticMeterTiming()`. Beat/downbeat boundaries must be edge-triggered on transport revision and index changes. The grid is unverified and cosmetic-only, never authoritative for physics or scoring. On pause/mute/fatal recovery, dancing should cease, without freezing core gameplay.

A small terrain-aware minimap should be top-right when the rider is bottom-left, otherwise bottom-left; it must not conceal other UI or imply globally known offscreen locations. Reduce Motion and World Dance OFF should suppress ornamental movement but not hide useful static information.

Music Friday owns real beat/phase research and YouTube source associations; CC Friday can review UI and title-overhaul overlap. Implement via separate modules; review with real browser smoke; do not merge without checks.
