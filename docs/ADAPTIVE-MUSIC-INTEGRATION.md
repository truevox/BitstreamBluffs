# Adaptive music engine integration — four-song private preview (2026-11-17)

**Status:** engine code integrated against Bitstream Bluffs v2.15.1/current `main` code; four **provisional**, full-song six-stem packs are deployed on a Tailnet-only playable game preview. **Original audio masters, 11-stem One More Run session, and 32s orchestra-audition experiments are preserved.** This does not imply owner approval of the experimental biome instrument performances or publish the unreleased promo music.

## Playable private proof

- **Full game:** `http://100.115.120.66:8187/` — Tailnet only; service `bitstream-game-four-song-preview.service` on CT223, bound to `100.115.120.66:8187`, not `0.0.0.0`.
- **Listening laboratory:** `http://100.115.120.66:8186/` remains a **separate** private research A/B player and is unchanged.
- The private game's static build lives at `/home/hermes/experiments/bitstream-engine-integrated-20261117/site/`. Its `music/` subtree is a **runtime/deployment-only artifact outside Git**.
- The derived private Opus media source/QA roster on CT211 lives under `/root/bitstream-maxi/four-song-packs-20261117/`; immutable source masters under `/root/bitstream-maxi/launch33/`.

Four exact source identities:

| User-facing title | Pack ID | Source grouping | Full duration |
|---|---|---|---:|
| Pope Leo Wants the AI Root Password | `FEsxYVStla4` | original six FLAC stems | 214.98 s |
| One More Run (The Ballad of Bitstream Bluffs) | `local-one-more-run-bitstream-bluffs` | existing grouped six derivative from user's preserved original **eleven** session stems | 174.60 s |
| Every Hacker (Runs Out of Code) — Part 2 | `WRBGQUqD54U` | original six FLAC stems | 198.55 s |
| Varmont Is Saved | `FYImnz5-hXs` | original six FLAC stems | 172.91 s |

The private packs contain **390 compressed Ogg Opus chunks**, 48,000 Hz stereo, 12-second segments, per-stem 64k target VBR. For each source/song, six stems have the same sample-frame boundaries; `pack.json` enumerates each chunk using `startFrame` and `frames`, not free-running timestamps. *One More Run* grouping is not a claim that the six stems null perfectly against the original separate WAV master; it is a reversible game-soundtrack grouping.

## Gameplay engine

Ported the source-only music modules (previous `feature/music-four-family-prototype`) into a **fresh integration branch based on the latest `main`**, preserving all gameplay and campaign changes. WebAudio loading and routing are attached to existing `AudioSynth` music filter/duck/master pipeline; separate SFX bus remains unchanged.

The engine loads `/music/catalog.json`, validates manifest/chunk paths, prefetches and frame-schedules original `vocals, drums, bass, guitar, piano, other` sources, and exposes the existing optional adaptive 4x12 buses and biome-aware effects for future orchestra replacements. Biome changes, ground/air state, sled speed and combo dynamics are wired through actual game events and update hooks. **Current provisional full-length packs are original stems**, not the 11 fully redone biome orchestras (those remain 32-second unapproved private samples). No private audiolab source JSON or weights are deployed.

### Player-controlled track selection

The Settings panel has four independent persistent on/off switches. It stores **`settings.musicEnabledSongs`**, sanitized against the four allowed IDs; unknown keys/invalid values cannot inject new tracks. Disabled songs are skipped at selection and rotation, even when only one remains. Switching the last active song off **stops sampled stems and stops the legacy procedural synth**; **all four off = NO MUSIC** (including after page reload), while independent sound effects continue. No surprise fallback track, randomized theme or procedural music. When at least one song is enabled but a media pack is missing/not ready, the existing procedural generator is still a safe compatibility fallback; that is *not* the all-off case.

At an actually started song, the engine emits `EVT.MUSIC_TRACK_CHANGED` with `{id,title}`; the existing UIScene serialized toast/banner displays a brief **▶ NOW PLAYING: [song title]**, with width clamped by the game's pixel font. No new huge UI overlay was added, and biome/mission toast scheduling remains serialized.

## QA evidence

- All four catalog IDs, `pack.json` manifests, exact source identities, six required stems, 48kHz sample-frame accounting and 390 derivative assets verified on private preview.
- Real Chromium/WebGL game loaded, reached RunScene, played the first **full 214.98-second** track from six actual active source buffers, and displayed the real `NOW PLAYING` HUD text (not a mocked event).
- Disabling all tracks **mid-run** stopped both streamed stems and procedural scheduler; **SFX bus remained intact**.
- Enabling only `Varmont Is Saved` immediately began Varmont.
- Persisting ALL OFF via SaveStore, reloading the page, then starting another run preserved silence and sound effects.
- Real browser: **no page exceptions and no failed media requests** across full-game test.
- **45 focused music and playlist Jest tests passed**, across five suites.
- Production Vite build succeeded; music pack source files are Git-safe (Python uses tab indentation). Additional broad-suite baseline failures in unrelated legacy `js/` tests may exist; report separately after comparison.
- Private preview service is bound to the Tailnet IP; original media stays off Git and the public Netlify release.

## Source and reversible rebuild

Source-only:
- `src/systems/music/*`, `src/systems/AudioSynth.js`, `src/systems/SaveStore.js`, `src/ui/Views.js`, `src/scenes/UIScene.js`, `src/scenes/RunScene.js`, `src/events.js`.
- `tools/music/pack_song.py` for one verified six-stem song; `tools/music/build_four_track_packs.py` for all four including the safe grouped-six One More Run mapping. These do not alter originals.
- `tools/music/smoke-game-four-song.mjs` drives **real Chromium**, per-song controls, in-game toast, live all-off, persistence, and re-enable.
- `tests/src/music-selection.test.js` and existing dedicated audio/music tests.

Rebuild private packs on the authorized CT211 host:

```sh
python3 tools/music/build_four_track_packs.py \
  --master /root/bitstream-maxi/launch33 \
  --out /root/bitstream-maxi/four-song-packs-NEW-VERSION \
  --chunk-seconds 12 --bitrate 64k
```

The builder refuses overwriting an existing output root and never alters `launch33` masters. To change songs in the future, rebuild only affected pack metadata and segments, and deploy that under `music/`; the gameplay integration and song selection can remain unchanged.

**Publication boundary:** This repository's `main` can safely carry engine/source/UI code **without publishing private Ogg music**. A public Netlify deployment with no `/music/catalog.json` will continue procedural legacy music when songs are enabled; the above **private** game preview carries all four actual tracks. Publishing full media to a public build should be an explicit later decision, especially unreleased *One More Run*. Owner musical evaluation and final mastering/licensing remain separate tasks.
