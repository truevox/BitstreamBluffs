// Keyboard-only layout conversion. Menu navigation always uses the independent legacy action mapping.
// Corkscrew was approved by Marvin on 2026-11-18: dedicated composite yaw/pitch trick.
export const CONTROL_LAYOUTS = Object.freeze({
  TRICKS_RIGHT: 'tricksRight',
  TRICKS_LEFT: 'tricksLeft',
  CLASSIC: 'classic',
});
export const DEFAULT_CONTROL_LAYOUT = CONTROL_LAYOUTS.TRICKS_RIGHT;
export const normalizeControlLayout = (value) =>
  Object.values(CONTROL_LAYOUTS).includes(value) ? value : DEFAULT_CONTROL_LAYOUT;

export const TRICK_KEYS_RIGHT = Object.freeze({
  ArrowUp: 'tiltForward',   // frontflip / clockwise pitch
  ArrowDown: 'tiltBack',    // backflip
  ArrowRight: 'heliRight',  // single helicopter input
  ArrowLeft: 'corkscrew',  // distinct corkscrew, not a reverse helicopter
  KeyW: 'parachute',
  KeyA: 'airBrake',
  KeyS: 'divebomb',
  KeyD: 'tuck',
});
export const TRICK_KEYS_LEFT = Object.freeze({
  KeyW: 'tiltForward',
  KeyS: 'tiltBack',
  KeyD: 'heliRight',
  KeyA: 'corkscrew',
  ArrowUp: 'parachute',
  ArrowLeft: 'airBrake',
  ArrowDown: 'divebomb',
  ArrowRight: 'tuck',
});

/** Return override for gameplay-bound keys only. Undefined means use existing classic mapping. */
export function layoutButton(layout, code) {
  const table = layout === CONTROL_LAYOUTS.TRICKS_LEFT ? TRICK_KEYS_LEFT
    : layout === CONTROL_LAYOUTS.TRICKS_RIGHT ? TRICK_KEYS_RIGHT : null;
  return table && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}
