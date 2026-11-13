/**
 * OWNER: UI engineer.
 * Phaser-free HUD layout helpers (rectangles are {x, y, w, h} in game pixels, 480x270).
 * UIScene uses them to stack the centre banners (landing, boost, strip, popups) in separate slots that also dodge the fixed
 * HUD rows and the on-screen touch buttons, and to find a free spot for the bottom row (power-ups, tutorial chip).
 */

/** True when the two rectangles overlap (pad grows `b` on every side: a minimum clear gap). */
export function rectsHit(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/**
 * Stack centred items top to bottom. Each item is {w, h, pref?, cx?}: it takes `max(cursor, pref)` as its top, is pushed below any
 * keep-out rectangle it would touch, and the next item starts `gap` under it. Items that do not collide stay at `pref`
 * (their classic position). Returns the top y of every item, in order.
 * @param {{w:number,h:number,pref?:number,cx?:number}[]} items
 * @param {{cx:number, startY?:number, gap?:number, keepOuts?:{x:number,y:number,w:number,h:number}[]}} opts
 * @returns {number[]}
 */
export function stackY(items, { cx, startY = 0, gap = 3, keepOuts = [] }) {
  const out = [];
  let cursor = startY;
  for (const it of items) {
    let y = Math.max(cursor, it.pref || 0);
    const x = (it.cx === undefined ? cx : it.cx) - it.w / 2;
    for (let guard = 0; guard < 64; guard++) {
      const hit = keepOuts.find((k) => rectsHit({ x, y, w: it.w, h: it.h }, k, gap - 1));
      if (!hit) break;
      y = hit.y + hit.h + gap;
    }
    out.push(y);
    cursor = y + it.h + gap;
  }
  return out;
}

/**
 * True when a full-width band at [y, y+h) would paint through any keep-out rectangle.
 *
 * A band is a different shape from a text box: the strip and the biome banner span the whole 480 px
 * row, so it is not enough for their own measured text to miss the fixed HUD rows - the background
 * fill crosses the row and draws over whatever sits there. That is the W2 defect (a mission toast
 * painted through "FLOW x1.25" and the trick popups) and the same bug shape the biome banner would
 * have inherited.
 * @param {{y:number,h:number}} band
 * @param {{x:number,y:number,w:number,h:number}[]} keepOuts
 * @param {number} [width=480] band width (the whole row by default).
 * @param {number} [gap=0] clear gap required.
 * @returns {boolean}
 */
export function bandHits(band, keepOuts, width = 480, gap = 0) {
  const box = { x: 0, y: band.y, w: width, h: band.h };
  return (keepOuts || []).some((k) => rectsHit(box, k, gap));
}

/**
 * Top y for a full-width band of height `h`, at or below `pref`, that clears every keep-out row.
 * Stays at `pref` when it is already clear, so the strip keeps its classic position on a quiet HUD.
 * @param {number} h band height
 * @param {number} pref preferred top y
 * @param {{x:number,y:number,w:number,h:number}[]} keepOuts
 * @param {{gap?:number, maxY?:number, width?:number}} [o]
 * @returns {number}
 */
export function placeBand(h, pref, keepOuts, o = {}) {
  const gap = o.gap === undefined ? 3 : o.gap;
  const width = o.width === undefined ? 480 : o.width;
  const maxY = o.maxY === undefined ? 270 : o.maxY;
  let y = pref;
  for (let guard = 0; guard < 64; guard++) {
    const hit = (keepOuts || []).find((k) => rectsHit({ x: 0, y, w: width, h }, k, gap - 1));
    if (!hit) break;
    y = hit.y + hit.h + gap;
  }
  return Math.min(y, Math.max(pref, maxY - h));
}

/**
 * Left edge for a w x h box at row `y` that touches none of `keepOuts`, closest to `prefLeft`, within [min, max] (right limit of
 * the box). Null when no free spot exists on that row.
 * @returns {number|null}
 */
export function placeX(w, y, h, prefLeft, keepOuts, { min = 0, max = 480, gap = 3 } = {}) {
  const cands = [prefLeft];
  for (const k of keepOuts) cands.push(k.x + k.w + gap, k.x - w - gap);
  let best = null;
  for (const left of cands) {
    if (left < min || left + w > max) continue;
    const box = { x: left, y, w, h };
    if (keepOuts.some((k) => rectsHit(box, k, gap - 1))) continue;
    if (best === null || Math.abs(left - prefLeft) < Math.abs(best - prefLeft)) best = left;
  }
  return best;
}
