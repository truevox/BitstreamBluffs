/**
 * W4 shop — the SHOP view's layout, kept Phaser-free so it can be overlap-tested in Jest.
 *
 * Same contract as ProfileLayout: every box is in panel-local game pixels, `x`/`y` is the TOP-LEFT
 * corner and `w`/`h` the measured extent, so a test can intersect boxes directly and a renderer can draw
 * left-anchored without re-applying an origin.
 *
 * ONE LIST, NOT TWO. The first version of this view drew a static layer of headers and item names AND a
 * MenuList of the same rows at a different pitch, so every line was two strings on top of each other (CC
 * Friday's W4 rejection, defect 1). The fix is structural, not cosmetic: this module returns a single
 * ordered list of rows — each either a header (drawn, never selectable) or an interactive row — and the
 * view feeds exactly that list to one MenuList. A header can no longer land on a row's y, because nothing
 * is positioned independently any more.
 *
 * Defect 2 was the same root cause from the other side: the static layer could never be refreshed, so
 * after a purchase the bank line still read the old balance. Now every visible string is a row in one
 * list, so rebuilding after a purchase redraws all of it.
 */
import { measureText } from './PixelFont.js';
import { SHOP_ITEMS, isOwned, soldInShop } from '../systems/ProfileStore.js';

/** Shop panel: wide enough for "NAME .......... 120" with the price right-aligned. */
export const SHOP_PANEL = Object.freeze({ w: 416, h: 236 });

const GLYPH_H = 8;
const PAD = 12;
// 11, not 13: the panel carries 18 rows (a bank line, four slot headers, eight items, a boosts header,
// two toggles, a loadout header and the loadout line). At 13 that is 234px of rows plus margins, which
// grew the panel to 272 and pushed it off a 270px screen; at 11 it is 198px and the panel is 236. A glyph
// is 8 tall, so 11 still leaves 3px of clear air between lines.
const ROW_H = 11;

const BOOSTS = Object.freeze([
  { id: 'errorCorrection', label: 'ERROR CORRECTION' },
  { id: 'headStart', label: 'HEAD START' },
]);

const upper = (s) => String(s === undefined || s === null ? '' : s).toUpperCase();

/**
 * The whole shop as one ordered list of rows.
 *
 * Row shapes:
 *   { kind:'header', key, label }                    — section heading, never selectable
 *   { kind:'item',   key, id, label, state, disabled, owned, equipped, locked, price }
 *   { kind:'boost',  key, id, label, on }            — a toggle row
 *   { kind:'static', key, label, color }             — the loadout line, never selectable
 * Every row owns its measured text box in `texts`; that array is what the overlap test intersects.
 *
 * @param {Object} o
 * @param {Object|null} o.profile
 * @returns {{w:number,h:number,rows:Array,texts:Array<{key:string,text:string,x:number,y:number,w:number,h:number,color:string}>,
 *            rowH:number, band:{x:number,y:number,w:number}, bankText:string, loadoutText:string, firstSelectable:number}}
 */
export function shopLayout(o = {}) {
  const profile = o.profile || {};
  const equipped = (profile.equipped && typeof profile.equipped === 'object') ? profile.equipped : {};
  const boosts = (profile.boosts && typeof profile.boosts === 'object') ? profile.boosts : {};
  const bank = Number.isFinite(profile.bank) ? profile.bank : 0;
  const level = Number.isFinite(profile.level) ? profile.level : 1;

  const rows = [];
  const texts = [];

  // Title band. The panel's own Panel object draws the frame title, so this row carries the BANK only —
  // and it is a row like any other, which is what keeps it refreshable.
  const bankText = `BANK ${bank}`;
  rows.push({ kind: 'head', key: 'head', label: '', right: bankText });

  // Catalogue: grouped by slot, cheapest first inside a group, so like is compared with like.
  const sorted = [...SHOP_ITEMS]
    .filter((i) => soldInShop(i)) // single predicate, shared with the affordability helper: see soldInShop()
    .sort((a, b) => (a.slot === b.slot ? a.price - b.price : String(a.slot).localeCompare(String(b.slot))));

  let lastSlot = null;
  for (const it of sorted) {
    if (it.slot !== lastSlot) {
      rows.push({ kind: 'header', key: `hdr-${it.slot}`, label: upper(it.slot) });
      lastSlot = it.slot;
    }
    const owned = isOwned(profile, it.id);
    // equip() stores the catalogue's VALUE ('mint'), older profiles may hold the ID; accept both.
    const isEquipped = equipped[it.slot] === it.id || equipped[it.slot] === it.value;
    const locked = level < (it.unlockLevel || 1);
    const affordable = bank >= (it.price || 0);

    // State is in the TEXT, not only the colour: colourblind mode and a small screen both have to tell
    // "owned" from "buy" from "locked", and colour alone cannot do that.
    let state;
    if (isEquipped) state = 'EQUIPPED';
    else if (owned) state = 'EQUIP';
    else if (locked) state = `LVL ${it.unlockLevel}`;
    else state = it.price > 0 ? String(it.price) : 'REWARD';

    rows.push({
      kind: 'item', key: `item-${it.id}`, id: it.id, slot: it.slot, label: upper(it.name), state,
      owned, equipped: isEquipped, locked, affordable, price: it.price,
      disabled: locked || isEquipped || (!owned && !affordable),
    });
  }

  // Boosts are part of the same list because they are part of the same panel. The old view positioned
  // them from an estimate of the catalogue's height, which is exactly how they landed on the TRAIL rows.
  rows.push({ kind: 'header', key: 'hdr-boosts', label: 'BOOSTS' });
  for (const b of BOOSTS) {
    rows.push({ kind: 'boost', key: `boost-${b.id}`, id: b.id, label: b.label, on: boosts[b.id] === true });
  }

  // Loadout: what the next run will actually look like.
  rows.push({ kind: 'header', key: 'hdr-loadout', label: 'LOADOUT' });
  const loadoutText = ['trail', 'glow', 'rider', 'theme']
    .map((slot) => {
      const v = equipped[slot];
      const shown = (v && v !== 'default') ? upper(String(v).replace(/^[a-z]+-(hue|glow)-/, '')) : 'DEFAULT';
      return `${upper(slot)} ${shown}`;
    })
    .join('  ');
  rows.push({ kind: 'static', key: 'loadout', label: loadoutText, color: 'text' });

  // Lay the rows out and measure every drawn string. Because y comes from this single loop, a row's text
  // and the menu's own row geometry cannot disagree.
  let y = 8;
  let firstSelectable = -1;
  rows.forEach((r, i) => {
    r.y = y;
    r.index = i;
    if (r.kind === 'head') {
      const bw = measureText(r.right);
      r.texts = [{ key: 'head-right', text: r.right, x: SHOP_PANEL.w - PAD - bw, y, w: bw, h: GLYPH_H, color: 'amber' }];
    } else if (r.kind === 'item') {
      if (firstSelectable < 0) firstSelectable = i;
      const right = r.state;
      const rw = measureText(right);
      const labelColor = r.equipped ? 'lime' : (r.locked ? 'text' : 'text');
      r.texts = [
        { key: `${r.key}-label`, text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: labelColor },
        { key: `${r.key}-right`, text: right, x: SHOP_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H,
          color: r.equipped ? 'cyan' : (r.owned ? 'lime' : (r.locked ? 'text' : 'amber')) },
      ];
    } else if (r.kind === 'boost') {
      if (firstSelectable < 0) firstSelectable = i;
      const stateText = r.on ? 'ON' : 'OFF';
      const rw = measureText(stateText);
      r.texts = [
        { key: `${r.key}-label`, text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: 'text' },
        { key: `${r.key}-right`, text: stateText, x: SHOP_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H, color: r.on ? 'lime' : 'text' },
      ];
    } else {
      r.texts = [{ key: `${r.key}-label`, text: r.label, x: PAD, y, w: measureText(r.label), h: GLYPH_H, color: r.kind === 'header' ? 'magenta' : (r.color || 'text') }];
    }
    for (const t of r.texts) texts.push(t);
    y += ROW_H;
  });

  // Height: last row, plus room for the BACK button the base View pins to the panel floor.
  const contentH = y + 30;
  return {
    w: SHOP_PANEL.w,
    h: Math.max(SHOP_PANEL.h, contentH),
    rows,
    texts,
    rowH: ROW_H,
    band: { x: PAD - 6, y: 8, w: SHOP_PANEL.w - (PAD - 6) * 2 },
    bankText,
    loadoutText,
    firstSelectable,
  };
}

/**
 * MenuList items for the shop: the SAME rows in the SAME order. Headers and the loadout line become
 * non-selectable rows so the menu's geometry places them too — the single-geometry rule again.
 *
 * `onSelect` is left null here; the view attaches the buy/equip handler by id, because this module must
 * stay Phaser-free and side-effect-free.
 *
 * @param {Object} layout
 * @returns {Array<Object>}
 */
export function shopMenuItems(layout) {
  return layout.rows.map((r) => {
    if (r.kind === 'item') {
      return { kind: 'action', id: r.id, label: r.label, sub: r.state, rowKind: 'item', disabled: r.disabled, onSelect: null };
    }
    if (r.kind === 'boost') {
      return {
        kind: 'choice', id: r.id, label: r.label, rowKind: 'boost', boostId: r.id,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => r.on, set: null,
      };
    }
    // head / header / static: drawn, never selectable, never focusable.
    return { kind: 'static', label: r.label, rowKind: r.kind, key: r.key, disabled: true };
  });
}

export { ROW_H as SHOP_ROW_H, GLYPH_H as SHOP_GLYPH_H };
