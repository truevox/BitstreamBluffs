# DESIGN.md — Bitstream Bluffs design system

> **Read this before building or changing any screen.** It writes down the design system that
> already exists in `src/ui/` and the decisions from the Nov 26–27, 2026 CEO and design reviews.
> **The code is the source of truth.** If this file and the code disagree, the code wins, and the
> file gets fixed in the same PR.
>
> Last updated from `main` @ `5d31860` (Nov 27, 2026, after the design review outside-voice round). Suggested line for `AGENTS.md`:
> *"Before building or changing any screen, read `DESIGN.md`."*

---

## 1. Identity

A **synthwave arcade cabinet**: a downhill neon trick race, played on a CRT. Chrome wordmark, a
striped sun, layered neon ridgelines, a perspective grid floor, scanlines, and a 5×7 pixel font.

Principles:

- **Amplify the relationship, hide the machinery.** Every interface should amplify the player's
  relationship with the game, the slopes, or their riders. If an interface mainly exposes the machinery
  underneath (hyperparameters, algorithm names, raw stats), it belongs in Advanced.
- **One cabinet, one voice.** Every screen, including the Evolution Lab, uses this visual language.
  Nothing looks like a different product with a neon coat of paint.
- **Crisp pixels.** Native 480×270 grid, integer text scales, pixel-exact strokes. No blur shaders.
- **Colour comes from the palette, never from the art.** That keeps accessibility and themes working.
- **The retry loop is sacred.** Nothing interrupts a run or delays an instant retry.
- **Every screen works with keyboard, gamepad, mouse and touch.**

## 2. Canvas and scaling

| Thing | Value | Where |
|---|---|---|
| Logical canvas | **480 × 270** | `GAME_WIDTH`, `GAME_HEIGHT` in `src/constants.js` |
| Rendering | `pixelArt: true`, `roundPixels: true` | `src/main.js` |
| Scaling | `Phaser.Scale.FIT`, `CENTER_BOTH` (letterboxed) | `src/main.js` |
| Coordinates | Always native 480×270 px | all layout modules |

Design and lay out at native size. A mockup at 2× is 960×540, at 4× is 1920×1080.

## 3. Colour

### 3.1 Palette keys

Only these keys exist (`PALETTE_KEYS` in `src/constants.js`; values in `src/data/palettes.json`):

| Key | Default | Colour-blind |
|---|---|---|
| `bg` | `#05060f` | `#05060f` |
| `bgAlt` | `#0c1024` | `#0c1024` |
| `cyan` | `#00f0ff` | `#56b4e9` |
| `magenta` | `#ff2bd6` | `#cc79a7` |
| `lime` | `#9dff3a` | `#f0e442` |
| `amber` | `#ffb000` | `#e69f00` |
| `text` | `#d8f6ff` | `#f2f2f2` |
| `danger` | `#ff3b3b` | `#d55e00` |

### 3.2 Rules (enforced in code)

1. **Use palette keys, never raw hex**, in game code (`ARCHITECTURE.md` §UI). Resolve through
   `Theme` (`theme.color(key)`, `theme.css[key]`) and paint inside `theme.bind(fn)` so a palette or
   theme change repaints live.
2. **`danger` is never recoloured**, by a biome (`withBiomePalette` skips it) or by an equipped UI
   theme (`Cosmetics.themedUiPalette`). Hazards must always read as hazards.
3. **The colour-blind palette wins.** It refuses equipped UI themes, and biome overrides merge on top
   of it key by key, so a biome can never undo an accessibility setting.
4. **Biome palettes are partial.** A biome only overrides the keys it wants to move.
5. **Authored art is white or greyscale** and gets its colour from `tint` (`MenuArt.js` rule 1). Never
   bake an accent colour into an asset.
6. **Art is optional.** A missing or broken asset returns `null` and the caller draws its procedural
   fallback (`MenuArt.js` rule 2).

### 3.3 Accent roles (proposed convention, not yet enforced)

Current code uses the accents roughly like this. Adopt it for new screens so meaning stays consistent:

| Key | Role |
|---|---|
| `cyan` | UI chrome and primary structure: panel borders, terrain lines, neutral controls |
| `magenta` | Brand and headline moments: titles, the daily patch name, emphasis |
| `lime` | Positive, active and "go": selected/primary action, success, training progress |
| `amber` | Rewards, currency and time: Shards and Bits, timers, rented and expiring things |
| `danger` | Hazards, crashes and destructive actions only |
| `text` | Body copy |

**Colour is never the only signal.** Any state shown by colour (rented, locked, stale, error) also
gets an icon or a word, so it survives the colour-blind palette.

## 4. Typography

- **Font:** runtime-generated 5×7 bitmap font, no image assets (`src/ui/PixelFont.js`).
  - `bb`: crisp white glyphs, tinted with palette colours.
  - `bbo`: the same glyphs dilated by 1 px, drawn behind `bb` as a dark outline or a coloured glow.
  - Proportional, 1 px letter spacing, `FONT_LINE_H = 9` font px.
- **Integer scales only**, so pixels stay square:

| Scale | Use |
|---|---|
| 1 | Body, labels, hints. **The minimum.** Nothing smaller. |
| 2 | Section headings, rule names, emphasised values |
| 3–4 | Hero moments (big banners, "PRESS START") |

- **Measure, don't guess:** `measureText`, `ellipsize`, `wrapText(str, maxPx, maxLines)`.
- **Limited glyph set:** printable ASCII plus `← → ↑ ↓ ▶ ▲ ▼ ■ ✓`. Check with `hasGlyph(ch)`.
  **No** em dashes, middle dots, ellipsis characters, curly quotes, ×, −, ♪ or emoji in game text. Use
  `-`, `..` (what `ellipsize` does), `x` and ASCII quotes. Pixel icons (lock, shard, tick) live in
  `ViewChrome.js` as glyph patterns.
- `NeonText` (`src/ui/Neon.js`) is the standard text object: crisp text with an outline or glow,
  anchored with `anchor` and `vAnchor`.

## 5. Components (use these, don't re-invent)

| Component | File | Notes |
|---|---|---|
| `Panel` | `Panel.js` | Dark glass, double neon border with falling-alpha "glow", angled title tab, breathing corner brackets. **Geometry contract:** (x, y) is the top-left, body is exactly w×h, title at (8, 4), content starts below y 16, glow paints at most 2 px outside. |
| `Button` | `Button.js` | Pointer and touch. Hit zone is exactly w×h. Hover glow, press flash. Keyboard and gamepad reach the same action through scene hotkeys, and the host calls `flash()` so they see the same feedback. |
| `MenuList` | `MenuList.js` | Keyboard, gamepad, mouse and touch. Item kinds: `action`, `choice`, `slider`, `static`. Per item: `sub`, `color`, `disabled`, `badge`, `tint`, `heading`. Animated gliding cursor. |
| `MenuInput` | `MenuInput.js` | Normalises all devices to `up/down/left/right/confirm/cancel/alt/...`, dedupes within 60 ms, supports raw text entry and opt-in `retry`. |
| `View` | `View.js` | Base modal: centred panel plus BACK. Opens with a CRT zip, closes with a ghost frame. Host owns the dim layer. |
| `ViewChrome` | `ViewChrome.js` | Keycap hint rows, section headers, rules, glow progress bars, focus rings, state chips, staggered reveal, pixel glyphs. |
| `Scanlines` | `Scanlines.js` | Scanline and vignette overlay, CRT roll (menus only), one-time power-on intro. |
| `Backdrop` / `MenuArt` | `Backdrop.js`, `MenuArt.js` | Sun, layered mountains, logo, rider. Tinted art with procedural fallbacks. |
| `DomTextBox` | `DomTextBox.js` | Real text input when typing is needed (keeps typed keys away from the input router). |

## 6. Layout

- **Every rectangle comes from a layout module** (`MissionsLayout`, `ProfileLayout`, `ShopLayout`,
  `HudLayout`, `HowToPlayLayout`, `AchievementsLayout`, ...), never from numbers scattered in a scene.
- **Bands are asserted pairwise-disjoint in tests** (for example `tests/src/missionslayout.test.js`).
  A new screen gets its own layout module and overlap tests in the same PR.
- **Row counts are computed, not assumed:** `titleMenuLayout` derives geometry from the row count and
  warns if a menu doesn't fit, after an added seventh row once overlapped SETTINGS.
- **Spec at 1x before code.** Every new or redesigned screen gets a native 480x270 layout spec first:
  exact rectangles, text scale per string, maximum character counts and truncation rules, and the
  pixel size of every non-text graphic (sprite, primitive or glyph).
- **The title menu panel fits 6 rows** at the current 16 px pitch. The title is being reworked to fewer
  top-level rows (design review, outside-voice round): Resume sits directly beside Start when a save
  exists, Daily appears in exactly one place, Autopilot gets a row once unlocked, and supporting
  features live under MORE.
- **Title screen bands** (`TITLE_BANDS`): logo y 2–94, tagline y 96, horizon y 192, menu panel x 8–216
  at y 154–254, cabinet card x 316–472 at y 94–254, control hint y 258–266.

## 7. Motion

- All shared transitions live in `Motion.js` (easing, open/close, scene transitions).
- **Reduce motion:** setting `reduceMotion` = `auto | on | off`. `auto` follows
  `prefers-reduced-motion: reduce`, re-read live. When reduced, every transition collapses to a
  `REDUCED_MS` (120 ms) fade, and callers **skip shake, glitch, warp and parallax**.
- Helpers degrade gracefully (jump to the end state) when tweens are missing, so a transition can
  never strand a view half-open.
- Use `motionMs(ms, reduced)` instead of hard-coding durations.

## 8. Input

- **Four input methods for every screen:** keyboard, gamepad, mouse, touch. Pointer goes through
  `Button` and `MenuList`. Keyboard and gamepad go through `MenuInput` actions and scene hotkeys.
- Every pointer action has a keyboard and gamepad route, and the reverse.
- The control-hint row tells players the keys (`↑↓ SELECT  ENTER / A CONFIRM ...`).

## 9. Accessibility and screen sizes

Built in today: colour-blind palette, reduce motion (including the OS setting), the `danger`
invariant, and the four input methods. Decided in the Nov 27 design review (6A) and **not built yet**:

- **Reference devices:** phone landscape (about 667×375 CSS px) and a Kompanio Chromebook
  (1366×768). Every screen must read on both.
- **Minimum text:** scale 1 is the floor. No information is drawn smaller.
- **Touch targets:** at least about 44 CSS px on the phone reference, which is about **32 native px**
  per touch action at that scale. Enlarging hit zones around tightly packed rows only makes them
  overlap, so touch devices get a **separate compact layout** (fewer, larger actions; secondary views),
  not a padded desktop layout. Trigger it by input and device (coarse pointer, small viewport), never by
  canvas size.
- **Decision-critical text on phones uses scale 2.** Scale 1 is for supplementary information.
- **Portrait:** an on-brand "rotate your device" screen, not a squashed game.
- **Never colour alone** (see §3.3).

## 10. Evolution Lab and Autopilot vocabulary (design review 4A)

The Lab speaks the cabinet's language, **not** a machine-learning dashboard:

| Concept | How it's drawn |
|---|---|
| Generations | Neon **ghost trails** of recent champions down the slope |
| Fitness | An arcade **score bar** with high-score ticks and a `NEW BEST` flash |
| Sim-Slots | A row of **mini cabinets**, each with a tiny rider. Rented = amber with a timer. Locked = static. |
| Lineage | A **family tree** of pixel-portrait cards with names (Gen 1 "faceplant" ... champion) |
| Charts, sliders, hyperparameters | Behind an **ADVANCED** panel, never the main view |

Layout and flow rules (design review plus outside-voice round):

- **Spectacle first.** The live training view takes most of the Lab screen (roughly 60-70%). Rider
  identity and score share one compact overlay. Lineage lives on the rider detail screen. Slot
  management is its own secondary screen. Limit ghost trails: one prominent rider plus a few fading
  trails.
- **One contextual main action** that reflects state (for example "PUT RIDER TO WORK (+0.17 KM)" when
  the trainee beats the working rider, "PAUSED - RESUME" when stopped), plus MAKE A REEL.
- **Timers stay quiet.** The 12-hour unattended-training limit is a safety pause: no countdown in the
  main view; it appears only when it triggers ("cabinet cooling down - resume"). Rented-slot timers
  live on the slot screen, which also states that slots are paid with Bits earned in play. The
  mechanics (12-hour limit, Bits-paid rentals and boosts) are unchanged.
- **Show provenance only when it is measured.** Never display a split like "NEAT 82% / tapes 18%"
  unless the trainer emits that number; otherwise show honest counts ("212 GENS, 4 OF YOUR TAPES").
- **The guided first run must be reliable and honest:** a tested intro course and starting population,
  a bounded time budget, celebration of whatever real milestone happens (lasting longer, clearing the
  first gap, landing), real progress kept if no milestone arrives, and never a faked result. Say "YOU
  TAUGHT THAT" only when the player's tape actually contributed; otherwise celebrate evolution.
- **The claim moment is a celebration, not a sale:** optional name, look, PUT RIDER TO WORK, MAKE A
  REEL. No unlock pitch on this screen or anywhere in the guided run.
- **Naming works on every input.** Keyboard and touch use a real text input (`DomTextBox`); gamepad gets
  an on-screen keyboard or a "random name" option, and accepting the default name is always allowed.
- **"Teach it" on Game Over appears only when it matters:** after the first manual run, then only when
  the run beat the rider or did something the rider cannot do yet.
- **The return report is one short recap** with a visual before/after, Bits credited automatically
  (the button acknowledges, it doesn't collect), and one CONTINUE. Report only what really ran:
  training happens only while the game is open, offline Autopilot earnings are modeled from real runs,
  and the two are never blurred together.

Beginner-facing vocabulary (technical terms stay available in Advanced):

| Internal term | Player-facing |
|---|---|
| Sim-Slot | Training Slot |
| Governor | Training Speed (in settings) |
| Fitness | Performance / Best Run |
| Champion | Best Rider |
| Deploy to Autopilot | Put Rider to Work |
| Advanced parameters | Advanced Training |
| Rented 9H | 9H REMAINING |

Mockups on the design canvas (approved as mockups, not final art; drawn before the outside-voice round,
so where they disagree with the rules above, the rules win): Lab main, guided run and claim, return
report, crash and Game Over, revised title.

### Required states for new Lab and Autopilot screens

Loading, empty, error, success and partial are all designed. Highlights:

- **Empty never means blank.** The first Lab visit is the guided run.
- **Errors are loud and recoverable:** a crashed worker resumes from its checkpoint with a toast,
  and a failed brain save shows a red panel with retry and the reason.
- **Partial states are honest:** "training at 40% to keep your game smooth", a "re-evaluate" badge
  after a physics revision, offline earnings "at baseline until 20 real runs".

## 11. Monetization UI rules (CEO and design review decisions)

- **Free web:** sled and Autopilot, supported by **opt-in rewarded ads only**. Premium (Steam, unlock,
  honor button, schools): no ads, full Lab, offline Autopilot earnings, and **double Shards by
  default**, so paying never means slower progress than watching ads.
- **Ads are never mid-run, never stacked, never a nag, never a pop-up, and never delay RETRY.**
- **Crash rewind:** a pickup arms it. Premium rewinds work immediately. A free player who wants the
  rewind watches an ad; RETRY stays available the whole time and declining costs nothing. If the ad
  fails to load, the rewind is granted anyway. Explain the rewind when it is collected, not first at
  the crash.
- **Double Shards** is offered only when an ad is actually ready; with no ad, the offer is not shown.
- **Ads may help a player's result** (a rewind counts in ranked play). This is a deliberate decision:
  anyone can watch an ad, and the game never penalizes a failed ad load.
- **The Steam pitch** appears only after a real ceiling, at most weekly, in one place, and **always
  next to the honor button** ("Can't afford it? Unlock free"). Never in the first session, the guided
  run, the claim moment, rides or Game Over.
- **Privacy UI (once ads exist):** a neutral birth-year screen (no hint of the "right" answer), with
  the child-treatment ad setup for under-13s and a certified consent banner for EU/UK visitors.

## 12. New-screen checklist

- [ ] A 1x layout spec exists (rectangles, text scales, max characters, graphic sizes).
- [ ] Native 480×270 layout in a layout module, with overlap tests.
- [ ] Colours from palette keys through `Theme.bind`. Correct under the colour-blind palette and
      every equipped theme. `danger` only for danger.
- [ ] Text at integer scales, scale 1 minimum, only glyphs that pass `hasGlyph`.
- [ ] Built from `Panel`, `Button`, `MenuList`, `View` and `ViewChrome` where they fit.
- [ ] Keyboard, gamepad, mouse and touch all work. Control hint updated.
- [ ] Reduce motion respected (`motionMs`, no shake, glitch, warp or parallax when reduced).
- [ ] Loading, empty, error, success and partial states designed.
- [ ] Readable on the phone-landscape and Chromebook references. Touch hit zones big enough.
- [ ] State never shown by colour alone.
- [ ] Automated checks pass: only glyphs that pass `hasGlyph`, integer text scales only, no
      overlapping tap zones on the desktop or compact touch layout. (Checks to be added; see §13.)

## 13. Known gaps and tensions

- **The title's centre column.** `MissionsLayout` says the centre column (x 216–316) stays free so the
  sun, mountains, rider and vanishing point read. But it now holds up to five chips: `BACKUP SAVE`
  (y 168), `R RESUME SAVE` (y 186), `M MUSEUM` (y 204), the postcard chip (y 222), and `HOW TO PLAY` (y 240).
  Design review decision 1A (title hierarchy cleanup) resolves this, for example by folding the save
  chips into the TODAY card and the rest into a MORE row.
- **Title hierarchy (1A):** decided, not built. One primary action, one TODAY card, PRESS START only
  in true attract mode, and the `ENTER SEED` / sub-label overlap fixed.
- **Not yet reviewed:** the HUD and the Game Over screen as they run live.
- **Not yet designed:** the Autopilot screen, the age screen and the honor-button panel.
- **Lab engine vs. Lab UI:** the Lab's engine side is landing (real Web Worker bootstrap #134, local
  checkpoint storage #451, play-aware admission governor #453), but none of the Lab screens in §10
  exist yet. Build them to §10 and §12.
- **Accent roles (§3.3)** are a proposed convention, not enforced in code. Both outside reviewers asked
  for enforcement through shared components.
- **Automated UI checks** (glyph set, integer scales, overlapping tap zones) are decided but not built.
- **Autopilot needs a real design** centered on watching and managing riders (live race, recent
  accomplishments, racing against them), not just collecting Bits.

## Pulp camera (P1 #155)

Settings > **PULP** offers **99% LESS**, **ORIGINAL** (default), and **100% PULP**.
The existing Original camera remains byte-for-byte on its old presentation path.
99% Less is a steady, readable rider-centred 1x view without shake, zoom
kicks, sway, or roll. Reduce Motion (including an OS request under AUTO)
forces 99% Less and shows **LOCKED: LESS**, while preserving the user's saved
Pulp choice to restore when reduced motion is disabled.

100% Pulp uses a deterministic 2D drone-camera *intent*: signed focus,
look-ahead, zoom, and small roll, based only on the authoritative run seed,
simulation tick and sled/hazard/BSOD snapshots. It never reads rendered view
bounds into simulation decisions, never advances simulation RNG, and never
changes ground-hazard warn/hop cues. The same intent can be projected by a
future 3D renderer, but this phase does **not** install a 3D engine. Camera
bounds and look-ahead have conservative playability floors; subtitles, HUD,
menu and pause panels retain their native 480x270 screen-space alignment.
