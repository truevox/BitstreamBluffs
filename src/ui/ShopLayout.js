/**
 * W4 shop — the SHOP view's layout, kept Phaser-free so it can be overlap-tested in Jest.
 *
 * Same contract as ProfileLayout: every box is in panel-local game pixels, `x`/`y` is the TOP-LEFT
 * corner and `w`/`h` the measured extent, so a test can intersect boxes directly and a renderer can draw
 * left-anchored without re-applying an origin.
 *
 * The reason this exists as its own pure module: W2's HUD strip and W3's signature menu both shipped
 * overlapping text that only a human noticed in a screenshot. The shop has one row per catalogue item plus
 * a bank line plus a loadout line, so the collision risk is higher, not lower.
 */
import { measureText } from './PixelFont.js';
import { SHOP_ITEMS, isOwned } from '../systems/ProfileStore.js';

/** Shop panel: wide enough for "NAME .......... 120" with the price right-aligned. */
export const SHOP_PANEL = Object.freeze({ w: 416, h: 224 });

const GLYPH_H = 8;
const PAD = 12;
const ROW_H = 13;

/** 'sled-glow-warm' -> 'Sled Glow Warm'. Item names in the catalogue are already display-ready. */
function titleCase(s) {
  return String(s || '').toUpperCase();
}

/**
 * One row per catalogue item, grouped by slot so the player compares like with like.
 * @param {Object} o
 * @param {Object|null} o.profile
 * @returns {{w:number,h:number,items:Array<{key:string,text:string,x:number,y:number,w:number,h:number,color:string,align:string}>,
 *            rows:Array<{id:string,slot:string,name:string,owned:boolean,price:number,equipped:boolean,affordable:boolean,locked:boolean}>,
 *            band:{x:number,y:number,w:number,rowH:number}, bankText:string, loadoutText:string}}
 */
export function shopLayout(o = {}) {
  const profile = o.profile || {};
  const equipped = (profile.equipped && typeof profile.equipped === 'object') ? profile.equipped : {};
  const bank = Number.isFinite(profile.bank) ? profile.bank : 0;
  const level = Number.isFinite(profile.level) ? profile.level : 1;

  const items = [];
  const rows = [];
  const push = (key, text, x, y, color, align = 'left') => {
    const t = String(text === undefined || text === null ? '' : text);
    const w = measureText(t);
    items.push({ key, text: t, x: align === 'right' ? x - w : x, y, w, h: GLYPH_H, color, align });
  };

  push('title', 'SHARD SHOP', PAD, 10, 'cyan');
  push('bank', `BANK ${bank}`, SHOP_PANEL.w - PAD, 10, 'amber', 'right');

  // Catalogue rows, ordered by slot then price so the cheap entry in each group comes first.
  const sorted = [...SHOP_ITEMS]
    .filter((i) => i && i.slot !== 'title') // titles are shown in PROFILE, not sold twice here
    .sort((a, b) => (a.slot === b.slot ? a.price - b.price : String(a.slot).localeCompare(String(b.slot))));

  let y = 24;
  let lastSlot = null;
  for (const it of sorted) {
    if (it.slot !== lastSlot) {
      if (lastSlot !== null) y += 3; // breathing room between groups
      push(`hdr-${it.slot}`, String(it.slot).toUpperCase(), PAD, y, 'magenta');
      y += ROW_H;
      lastSlot = it.slot;
    }
    const owned = isOwned(profile, it.id);
    const isEquipped = equipped[it.slot] === it.id;
    const locked = level < (it.unlockLevel || 1);
    const affordable = bank >= (it.price || 0);

    // State is in the TEXT, not only the colour: colourblind mode and a small screen both have to be
    // able to tell "owned" from "buy" from "locked", and colour alone cannot do that.
    let state;
    if (isEquipped) state = 'EQUIPPED';
    else if (owned) state = 'EQUIP';
    else if (locked) state = `LVL ${it.unlockLevel}`;
    else state = it.price > 0 ? String(it.price) : 'REWARD';

    push(`item-${it.id}`, titleCase(it.name), PAD + 4, y, owned ? 'lime' : (locked ? 'text' : 'text'));
    push(`state-${it.id}`, state, SHOP_PANEL.w - PAD, y, isEquipped ? 'cyan' : (owned ? 'lime' : (locked ? 'text' : 'amber')), 'right');

    rows.push({
      id: it.id, slot: it.slot, name: it.name, owned, equipped: isEquipped,
      price: it.price, affordable, locked, label: state, y,
    });
    y += ROW_H;
  }

  // Loadout summary: what the next run will actually look like.
  y += 4;
  push('loadout', 'LOADOUT', PAD, y, 'cyan');
  y += ROW_H;
  const loadoutText = ['trail', 'glow', 'rider', 'theme']
    .map((slot) => `${slot.toUpperCase()} ${equipped[slot] && equipped[slot] !== 'default' ? String(equipped[slot]).replace(/^[a-z]+-(hue|glow)-/, '').toUpperCase() : 'DEFAULT'}`)
    .join('   ');
  push('loadout-v', loadoutText, PAD, y, 'text');
  y += ROW_H;

  const band = { x: PAD - 4, y: 24, w: SHOP_PANEL.w - (PAD - 4) * 2, rowH: ROW_H };
  return {
    w: SHOP_PANEL.w,
    h: Math.max(SHOP_PANEL.h, y + PAD),
    items,
    rows,
    band,
    bankText: `BANK ${bank}`,
    loadoutText,
  };
}

/**
 * The selectable rows in draw order, for the MenuList. Buying and equipping are ONE action from the
 * player's point of view ("get me this"), so the view decides which one applies rather than making the
 * player press BUY then EQUIP.
 * @param {Object} layout
 * @returns {Array<{id:string,label:string,disabled:boolean,kind:string}>}
 */
export function shopMenuItems(layout) {
  return layout.rows.map((r) => ({
    id: r.id,
    // The row already prints its own state on the right, so the menu label stays the name.
    label: r.name.toUpperCase(),
    kind: 'action',
    disabled: r.locked || r.equipped || (!r.owned && !r.affordable),
    state: r.label,
  }));
}
