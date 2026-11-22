# Issue #211 — gameplay-input reachability matrix

Bounded leaf: **verify current reachability and prove/disprove one suspected alias defect**. This is
*not* full issue #211 parity, and no controls were redesigned.

Baseline worked on: `5465e10` (draft-PR commit) on top of `origin/main` `b5b969d` (v2.19.5).

## Sources of truth (cited)

- Keyboard classic: `src/systems/InputRouter.js:26-42` (`KEYMAP`)
- Keyboard trick layouts: `src/systems/ControlLayouts.js:12-31` (`TRICK_KEYS_RIGHT`, `TRICK_KEYS_LEFT`)
  applied by `src/systems/InputRouter.js:150-155` (`_binding` → `layoutButton`)
- Gamepad: `src/systems/InputRouter.js:52-73` (`GP_BINDINGS`, W3C standard mapping)
- Touch overlay: `src/systems/TouchOverlay.js:35-55` (`TOUCH_CLUSTERS`) and
  `src/systems/TouchOverlay.js:66-71` (`touchButtonFor` swap)
- Pad buttons: `src/systems/VirtualPad.js:18-21` (`HELD_NAMES`); derivation `src/systems/PadDerive.js:16-27`

Run-time evidence: `tests/src/issue-211-input-reachability.test.js` (matrix) and
`tests/src/issue-211-gamepad-alias.test.js` (reproduction). The tests assert reachability through
`VirtualPad`'s real per-button held sets, not by re-reading the tables.

## Reachability table

`mapped` = the input can set that raw pad button / derived pad field. `NOT mapped` = it cannot.
Touch columns are the **Classic** overlay and the **Trick Deck** overlay (Tricks Right/Left share the
same touch swap: `touchButtonFor` treats any non-classic layout as `trickDeck`,
`src/systems/TouchOverlay.js:110-123`).

| Action (pad field) | Tricks Right keyboard | Tricks Left keyboard | Classic keyboard | Touch Classic | Touch Trick Deck | Standard gamepad |
|---|---|---|---|---|---|---|
| push | NOT mapped | NOT mapped | `KeyW` → push (`InputRouter.js:27`) | PUSH button (`TouchOverlay.js:45`) | NOT mapped (push→divebomb, `TouchOverlay.js:68`) | RT button 7 value > 0.25 (`InputRouter.js:60,48`) |
| brake | NOT mapped | NOT mapped | `KeyS` → brake (`InputRouter.js:30`) | BRAKE (`TouchOverlay.js:36`) | BRAKE still present (`TouchOverlay.js:36`, pass-through `TouchOverlay.js:70`) | B button 1 (`InputRouter.js:54`) |
| tuck | `KeyD` → tuck (`ControlLayouts.js:20`) | `ArrowRight` → tuck (`ControlLayouts.js:30`) | A+D together (derive, `PadDerive.js:23`) | TUCK (`TouchOverlay.js:37`) | TUCK (`TouchOverlay.js:37`) | LT button 6 value > 0.4 (`InputRouter.js:59,48`) |
| tiltBack | `ArrowDown` (`ControlLayouts.js:14`) | `KeyS` (`ControlLayouts.js:24`) | `KeyA` (`InputRouter.js:28`) | TILT BACK (`TouchOverlay.js:38`) | TILT BACK | D-pad left btn 14 (`InputRouter.js:65`) |
| tiltForward | `ArrowUp` (`ControlLayouts.js:13`) | `KeyW` (`ControlLayouts.js:23`) | `KeyD` (`InputRouter.js:29`) | TILT FWD (`TouchOverlay.js:39`) | TILT FWD | D-pad right btn 15 (`InputRouter.js:66`) |
| heliLeft | NOT mapped | NOT mapped | `ArrowLeft` (`InputRouter.js:34`) | SPIN CCW (`TouchOverlay.js:42`) | NOT mapped (heliLeft→corkscrew, `TouchOverlay.js:69`) | LB btn 4 **and** RS axis2 < −0.5 (`InputRouter.js:57,71`) |
| heliRight | `ArrowRight` (`ControlLayouts.js:15`) | `KeyD` (`ControlLayouts.js:25`) | `ArrowRight` (`InputRouter.js:35`) | SPIN CW (`TouchOverlay.js:44`) | SPIN CW | RB btn 5 **and** RS axis2 > 0.5 (`InputRouter.js:58,72`) |
| airBrake | `KeyA` (`ControlLayouts.js:18`) | `ArrowLeft` (`ControlLayouts.js:28`) | `ArrowUp` (`InputRouter.js:36`) | AIR BRAKE (`TouchOverlay.js:43`) | AIR BRAKE | X btn 2 (`InputRouter.js:55`) |
| parachute | `KeyW` (`ControlLayouts.js:17`) | `ArrowUp` (`ControlLayouts.js:27`) | `ArrowDown` (`InputRouter.js:37`) | CHUTE (`TouchOverlay.js:47`) | CHUTE | Y btn 3 (`InputRouter.js:56`) |
| divebomb | `KeyS` (`ControlLayouts.js:19`) | `ArrowDown` (`ControlLayouts.js:29`) | NOT mapped | NOT mapped (classic overlay has no divebomb) | DIVEBOMB (push→divebomb, `TouchOverlay.js:68`) | **NOT mapped — no gamepad binding** (`GP_BINDINGS`, `InputRouter.js:52-73`) |
| corkscrew | `ArrowLeft` (`ControlLayouts.js:16`) | `KeyA` (`ControlLayouts.js:26`) | NOT mapped | NOT mapped (classic overlay has no corkscrew) | CORKSCREW (heliLeft→corkscrew, `TouchOverlay.js:69`) | **NOT mapped — no gamepad binding** (`GP_BINDINGS`, `InputRouter.js:52-73`) |
| hop | Space (`InputRouter.js:31`) | Space | Space | HOP (`TouchOverlay.js:46`) | HOP | A btn 0 (`InputRouter.js:53`) |
| reset | ShiftLeft/Right (`InputRouter.js:32-33`) | ShiftLeft/Right | ShiftLeft/Right | RESET (`TouchOverlay.js:50`) | RESET | Back btn 8 (`InputRouter.js:61`) |
| pause | Escape (`InputRouter.js:38`) | Escape | Escape | PAUSE (`TouchOverlay.js:51`) | PAUSE | Start btn 9 (`InputRouter.js:62`) |
| confirm (edge) | Space/Enter (`InputRouter.js:31,39`) | Space/Enter | Space/Enter | **NOT mapped** (`confirm` not in TOUCH_CLUSTERS) | NOT mapped | A btn 0 (`InputRouter.js:53`) |
| Menu directions up/down/left/right | — | — | Arrow keys; W/S also emit up/down | — | — | D-pad 12/13 + left stick axes 0/1 (`InputRouter.js:63-70`) |

Note: D-pad left/right (buttons 14/15) are also read directly by `MenuInput._pollPad()` as menu
left/right (`src/ui/MenuInput.js:167-170`), which the per-action columns above do not express.

## Plain findings

- **`divebomb` has no gamepad binding.** `GP_BINDINGS` (`InputRouter.js:52-73`) contains no entry with
  `pad: 'divebomb'`.
- **`corkscrew` has no gamepad binding.** No `GP_BINDINGS` entry sets `pad: 'corkscrew'`. On a gamepad
  the Trick Deck's signature tricks are unreachable; on touch they exist only via the overlay swap.
- Trick Deck keyboard layouts (Tricks Right / Left) intentionally drop `push`, `brake` and `heliLeft`
  (verified: `tests/src/issue-211-input-reachability.test.js`), so Classic and the Trick Deck keyboard
  sets are not interchangeable.
- Touch `confirm` is never mapped: it is an edge-only pad field (`VirtualPad.js:17`) and has no overlay
  button, so touch users confirm via `anyKey`/`hop` paths only.
- **Ground brake default key is undecided (#30).** No ground-brake pad field exists in `HELD_NAMES`
  (`VirtualPad.js:18-21`); this matrix does not invent one.

## Gamepad alias defect (reproduced)

`GP_BINDINGS` binds two physical inputs to one pad button:

| Physical alias | Pad button | Binding |
|---|---|---|
| LB (button 4) | `heliLeft` | `InputRouter.js:57` |
| RSLeft (axis 2 < −0.5) | `heliLeft` | `InputRouter.js:71` |
| RB (button 5) | `heliRight` | `InputRouter.js:58` |
| RSRight (axis 2 > 0.5) | `heliRight` | `InputRouter.js:72` |

Before the fix, `_pollGamepads()` wrote each binding with the shared source id `'gamepad'`
(`VirtualPad.setButton` tracks sources per button, `VirtualPad.js:102-114`). Releasing one alias
removed `'gamepad'` from the button's held set and therefore cancelled the other alias still physically
held.

**Reproduction** (`tests/src/issue-211-gamepad-alias.test.js`, unchanged code) failed:

- `c. releasing LB keeps the still-deflected right stick holding heliLeft` — expected `heli === -1`,
  received `0`.
- `d. releasing the right stick keeps the still-held LB holding heliLeft` — expected `heli === -1`,
  received `0`.

**Fix (minimal, `src/systems/InputRouter.js:289-321`):** `_pollGamepads()` now aggregates all bindings
per target pad button (`padNext`) and writes the pad once per aggregate, still using the single
`'gamepad'` source. `GP_BINDINGS`, the pad public shape, `VirtualPad`'s contract and the emitted
`INPUT_ACTION` `source` (`'gamepad'`) are unchanged. After the fix all alias cases pass.

## Honest limitations

- **Gamepad polling granularity.** Gamepad state is sampled synchronously in `poll()`
  (`src/systems/InputRouter.js:332-342` → `_pollGamepads`, `:289-321`), not from timestamped DOM events. Presses shorter than
  one poll interval, or multiple edges between two polls, are coalesced. No gamepad event timestamps are
  fabricated and none are claimed to have keyboard parity; fair keyboard/touch scheduling is issue #115
  (`tests/determinism/fair-input*.test.js`), and this leaf does not extend it to gamepads.
- This is one bounded leaf. It does **not** claim issue #211 is complete.
