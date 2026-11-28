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
import { UPGRADE_CATALOG, sanitizeUpgradeRanks, nextUpgradePrice } from '../systems/PermanentUpgrades.js';
import {archiveCapacity,nextArchiveSlotPrice} from '../systems/ghost/CourseArchiveCapacity.js';
import { BSOD_GYM_PRICE, gymVisible, gymOwned, gymAdvanced, gymSetupForProfile, GYM_SETUP_OPTIONS } from '../systems/BsodGym.js';
import { SHOP_ITEMS, isOwned } from '../systems/ProfileStore.js';
import { loadLevelTable, levelForXp } from '../systems/Progression.js';

/** Shop panel: wide enough for "NAME .......... 120" with the price right-aligned. */
export const SHOP_PANEL = Object.freeze({ w: 416, h: 236 });

/**
 * The catalogue is shown one slot per page (audit F4 fit). The flat list was 247 of 248 px tall with nine
 * cosmetic rows; the eleven level rewards would have pushed it off a 270 px screen. Titles are not a page:
 * they are equipped (and Static Rider bought) from the Profile view's TITLES screen.
 */
export const SHOP_PAGES = Object.freeze(['trail', 'glow', 'rider', 'theme']);

const GLYPH_H = 8;
const PAD = 12;
// A glyph is 8 tall, so an 11 px pitch leaves 3 px of clear air between lines. The tallest page is the
// bank line, the page row, six items, a boosts header, two toggles, a loadout header and the loadout line:
// 13 rows, 143 px plus margins, inside the 236 px panel.
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
 *   { kind:'page',   key, label, state, slot, page }  — the page selector ("← TRAIL →", "1/4"); selectable
 *   { kind:'header', key, label }                    — section heading, never selectable
 *   { kind:'item',   key, id, label, state, disabled, owned, equipped, locked, price }
 *   { kind:'boost',  key, id, label, on, locked, unlockLevel, state, disabled }
 *                                                    — a toggle row; locked (not in unlocked.boosts) = disabled
 *   { kind:'static', key, label, color }             — the loadout line, never selectable
 * Every row owns its measured text box in `texts`; that array is what the overlap test intersects.
 *
 * @param {Object} o
 * @param {Object|null} o.profile
 * @param {Object} [o.levels] parsed levels.json (content.progression); only used to name the level that
 *   unlocks a locked boost. Without it a locked boost reads "LOCKED".
 * @param {number} [o.page] index into SHOP_PAGES (default 0); wraps both ways
 * @returns {{w:number,h:number,rows:Array,texts:Array<{key:string,text:string,x:number,y:number,w:number,h:number,color:string}>,
 *            rowH:number, band:{x:number,y:number,w:number}, bankText:string, loadoutText:string, firstSelectable:number,
 *            page:number, pageCount:number, pageSlot:string}}
 */
export function shopLayout(o = {}) {
  const profile = o.profile || {};
  const equipped = (profile.equipped && typeof profile.equipped === 'object') ? profile.equipped : {};
  const boosts = (profile.boosts && typeof profile.boosts === 'object') ? profile.boosts : {};
  const bank = Number.isFinite(profile.bank) ? profile.bank : 0;
  const level = Number.isFinite(profile.level) ? profile.level : 1;
  const grants = (profile.unlocked && typeof profile.unlocked === 'object' && profile.unlocked.boosts
    && typeof profile.unlocked.boosts === 'object') ? profile.unlocked.boosts : {};
  const levelRows = (o.levels && Array.isArray(o.levels.levels)) ? o.levels.levels : [];

  const rows = [];
  const texts = [];

  // Title band. The panel's own Panel object draws the frame title, so this row carries the BANK only —
  // and it is a row like any other, which is what keeps it refreshable.
  const bankText = `BANK ${bank}`;
  rows.push({ kind: 'head', key: 'head', label: '', right: bankText });

  // One slot per page, cheapest first inside it, so like is compared with like.
  const n = SHOP_PAGES.length;
  const rawPage = Number.isFinite(o.page) ? Math.trunc(o.page) : 0;
  const page = ((rawPage % n) + n) % n;
  const pageSlot = SHOP_PAGES[page];
  // The page row doubles as the slot heading: "← TRAIL →" with its position, so a player always knows
  // there is more than one page and where they are in it.
  rows.push({
    kind: 'page', key: 'page', slot: pageSlot, page, label: `← ${upper(pageSlot)} →`, state: `${page + 1}/${n}`,
    disabled: false,
  });
  const sorted = [...SHOP_ITEMS]
    .filter((i) => i && i.slot === pageSlot)
    .sort((a, b) => (a.price - b.price) || ((a.unlockLevel || 1) - (b.unlockLevel || 1)));

  for (const it of sorted) {
    const owned = isOwned(profile, it.id);
    // equip() stores the catalogue's VALUE ('mint'), older profiles may hold the ID; accept both.
    const isEquipped = equipped[it.slot] === it.id || equipped[it.slot] === it.value;
    // A biome grant (the Neon Sled Drone) is locked until its biome is completed, whatever the level, and its
    // locked state names the condition ("COMPLETE MICRO MOUNTAIN") rather than a level it does not have.
    const grantLocked = it.grant === 'biome' && !owned;
    const locked = grantLocked || level < (it.unlockLevel || 1);
    const affordable = bank >= (it.price || 0);

    // State is in the TEXT, not only the colour: colourblind mode and a small screen both have to tell
    // "owned" from "buy" from "locked", and colour alone cannot do that.
    let state;
    if (isEquipped) state = 'EQUIPPED';
    else if (owned) state = 'EQUIP';
    else if (grantLocked) state = upper(it.unlockText || 'LOCKED');
    else if (locked) state = `LVL ${it.unlockLevel}`;
    else state = it.price > 0 ? String(it.price) : 'REWARD';

    // SHOP-3: the EQUIPPED row is selectable, and selecting it returns the slot to DEFAULT (the view calls
    // ProfileStore.unequip). It used to be disabled, so focus skipped it and nothing on screen could ever
    // take a cosmetic back off. A separate DEFAULT row per page would cost a row the tallest page needs.
    rows.push({
      kind: 'item', key: `item-${it.id}`, id: it.id, slot: it.slot, label: upper(it.name), state,
      owned, equipped: isEquipped, locked, affordable, price: it.price,
      disabled: !isEquipped && (locked || (!owned && !affordable)),
    });
  }

  // Boosts are part of the same list because they are part of the same panel. The old view positioned
  // them from an estimate of the catalogue's height, which is exactly how they landed on the TRAIL rows.
  rows.push({ kind: 'header', key: 'hdr-boosts', label: 'BOOSTS' });
  // F3: a boost is offered only once the profile owns it. Ownership is the grant record ProfileStore
  // writes when a level-up crosses the boost's level (`unlocked.boosts[id]`, levels 8 and 15 today); the
  // shop shows that record, it does not re-derive it from the level. A locked boost stays visible, says
  // the level that unlocks it, and cannot be selected.
  for (const b of BOOSTS) {
    const locked = !grants[b.id];
    const entry = levelRows.find((l) => l && l.boost === b.id);
    const unlockLevel = entry && Number.isFinite(entry.level) ? entry.level : null;
    const on = boosts[b.id] === true;
    const state = locked ? (unlockLevel ? `LVL ${unlockLevel}` : 'LOCKED') : (on ? 'ON' : 'OFF');
    rows.push({ kind: 'boost', key: `boost-${b.id}`, id: b.id, label: b.label, on, locked, unlockLevel, state, disabled: locked });
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
  rows.push({ kind: 'upgradeLink', key: 'upgradeLink', label: 'PERMANENT UPGRADES', state: 'OPEN' });

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
    } else if (r.kind === 'page') {
      if (firstSelectable < 0) firstSelectable = i;
      const rw = measureText(r.state);
      r.texts = [
        { key: `${r.key}-label`, text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: 'magenta' },
        { key: `${r.key}-right`, text: r.state, x: SHOP_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H, color: 'magenta' },
      ];
    } else if (r.kind === 'upgradeLink') {
      const rw = measureText(r.state);
      r.texts = [
        { key: r.key + '-label', text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: 'lime' },
        { key: r.key + '-right', text: r.state, x: SHOP_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H, color: 'lime' },
      ];
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
      const stateText = r.state;
      const rw = measureText(stateText);
      r.texts = [
        { key: `${r.key}-label`, text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: 'text' },
        { key: `${r.key}-right`, text: stateText, x: SHOP_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H, color: (!r.locked && r.on) ? 'lime' : 'text' },
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
    page,
    pageCount: n,
    pageSlot,
  };
}

/**
 * Every item row the shop shows, across all of its pages, in page order. For callers that need the whole
 * catalogue as the shop presents it (the shop prompt's "is anything buyable here" agreement, for one).
 * @param {Object} o same options as shopLayout, minus `page`
 * @returns {Array<Object>} the `kind:'item'` rows
 */
export function shopAllRows(o = {}) {
  const out = [];
  for (let page = 0; page < SHOP_PAGES.length; page++) {
    for (const r of shopLayout({ ...o, page }).rows) if (r.kind === 'item') out.push(r);
  }
  return out;
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
    if (r.kind === 'page') {
      return { kind: 'action', rowKind: 'page', label: r.label, sub: r.state, page: r.page, disabled: false, onSelect: null };
    }
    if (r.kind === 'upgradeLink') return { kind: 'action', rowKind: 'upgradeLink', label: r.label, sub: r.state, disabled: false };
    if (r.kind === 'item') {
      return { kind: 'action', id: r.id, label: r.label, sub: r.state, rowKind: 'item', disabled: r.disabled, onSelect: null };
    }
    if (r.kind === 'boost') {
      // A locked boost is a disabled row that shows its unlock level instead of an ON/OFF value.
      if (r.locked) {
        return { kind: 'action', id: r.id, label: r.label, rowKind: 'boost', boostId: r.id, sub: r.state, disabled: true, onSelect: null };
      }
      return {
        kind: 'choice', id: r.id, label: r.label, rowKind: 'boost', boostId: r.id, disabled: false,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => r.on, set: null,
      };
    }
    // head / header / static: drawn, never selectable, never focusable.
    return { kind: 'static', label: r.label, rowKind: r.kind, key: r.key, disabled: true };
  });
}

/** Pure page for the permanent-upgrade catalog; shares the shop's single-row geometry. */
export function upgradeShopLayout(o = {}) {
  const profile = o.profile || {};
  const bank = Number.isSafeInteger(profile.bank) ? profile.bank : 0;
  const ranks = sanitizeUpgradeRanks(profile.upgrades);
  const rows = [
    { kind: 'head', key: 'head', label: '', right: 'BANK ' + bank },
    { kind: 'upgradeBack', key: 'upgradeBack', label: '← BACK TO SHOP', state: '' },
    { kind: 'upgradeToggle', key: 'upgradeToggle', label: 'UPGRADE MODE', state: profile.upgradesEnabled === true ? 'ON' : 'OFF' },
    { kind: 'header', key: 'header', label: 'PURCHASE PERMANENT RANKS' },
  ];
  for (const spec of UPGRADE_CATALOG) {
    const rank = ranks[spec.id];
    const price = nextUpgradePrice(spec.id, rank);
    rows.push({ kind: 'upgradeItem', key: 'upgrade-' + spec.id, id: spec.id,
      label: spec.label + ' R' + rank,
      state: price == null ? 'UNAVAILABLE' : '' + price,
      disabled: price == null,
    });
  }
  // The Gym remains entirely absent until the first legitimately scored
  // BSOD escape. Do not reveal how to earn that discovery in store copy.
  if (gymVisible(profile)) {
    const owned = gymOwned(profile);
    rows.push({ kind: 'gym', key: 'bsodGym', id: 'bsodGym',
      label: 'BSOD GYM', state: owned ? 'ENTER' : `LOCKED ${BSOD_GYM_PRICE}`,
      disabled: !owned && bank < BSOD_GYM_PRICE });
    // No disabled / mysterious hint row before the actual in-Gym 5x unlock.
    if (gymAdvanced(profile)) rows.push({ kind: 'gymSetupLink', key: 'bsodGymSetup',
      id: 'bsodGymSetup', label: 'GYM SETUP', state: 'OPEN' });
  }
  // Replaces two old footer hints rather than pushing the 236px panel
  // over its fixed BACK control in the advanced Gym page.
  const archiveRank=profile.courseArchive?.purchased||0;
  const archivePrice=nextArchiveSlotPrice(archiveRank);
  rows.push({kind:'archiveBuy',key:'archiveBuy',label:`COURSE SLOT +1 (${archiveCapacity(profile)} TOTAL)`,
    state:archivePrice===null?'UNAVAILABLE':String(archivePrice),
    disabled:archivePrice===null||bank<archivePrice});
  rows.push({kind:'archiveLink',key:'archiveLink',label:'MANAGE COURSE ARCHIVES',state:'OPEN'});
  const texts = [];
  let y = 8;
  for (const row of rows) {
    row.y = y;
    if (row.kind === 'head') {
      const w = measureText(row.right);
      row.texts = [{ key: 'head-bank', text: row.right, x: SHOP_PANEL.w - PAD - w, y, w, h: GLYPH_H, color: 'amber' }];
    } else {
      const left = row.kind === 'header' || row.kind === 'static' ? PAD : PAD + 6;
      row.texts = [{ key: row.key + '-label', text: row.label,
        x: left, y, w: measureText(row.label), h: GLYPH_H,
        color: row.kind === 'gym' ? 'cyan' : row.kind === 'upgradeItem' ? 'text' : row.kind === 'upgradeBack' ? 'cyan' : 'magenta' }];
      if (row.state) {
        const w = measureText(row.state);
        row.texts.push({ key: row.key + '-state', text: row.state,
          x: SHOP_PANEL.w - PAD - 6 - w, y, w, h: GLYPH_H, color: 'amber' });
      }
    }
    texts.push(...row.texts);
    y += ROW_H;
  }
  return { w: SHOP_PANEL.w, h: SHOP_PANEL.h, rows, texts, rowH: ROW_H,
    band: { x: PAD - 6, y: 8, w: SHOP_PANEL.w - (PAD - 6) * 2 } };
}

/** The course manager never auto-deletes: select an archive, THEN a separate
 * CONFIRM DELETE row. Changing the page clears the selection in the host. */
export function courseArchiveManagerLayout(o={}) {
  const archives=Array.isArray(o.archives)?o.archives:[];
  const total=Number.isSafeInteger(o.totalArchives)&&o.totalArchives>=archives.length?o.totalArchives:archives.length;
  const isFiltered=typeof o.query==='string'&&o.query.trim().length>0;
  const pageCount=Math.max(1,Math.ceil(archives.length/7));
  const page=Number.isSafeInteger(o.page)?((o.page%pageCount)+pageCount)%pageCount:0;
  const capacity=archiveCapacity(o.profile||{});
  const rows=[
    {kind:'head',key:'head',label:'',right:'BANK '+(o.profile?.bank||0)},
    {kind:'archiveBack',key:'archiveBack',label:'← BACK TO UPGRADES'},
    {kind:'header',key:'archiveHeader',label:isFiltered
      ?`MATCHING COURSES ${archives.length}/${total} - ${capacity} SLOTS`
      :`COURSE ARCHIVES ${archives.length}/${capacity}`},
    {kind:'archivePager',key:'archivePager',label:'FIND SEED  /  ← PAGE →',state:`${page+1}/${pageCount}`},
  ];
  const selected=typeof o.selected==='string'?o.selected:null;
  for(const course of archives.slice(page*7,(page+1)*7)) {
    const key=String(course.key);
    const seed=String(course.seed||'?');
    const mask=Number.isSafeInteger(course.biomeMask)?course.biomeMask:0;
    const favoriteCount=Array.isArray(course.favorites)?course.favorites.filter(Boolean).length:0;
    rows.push({kind:'archiveEntry',key:'entry-'+key,archiveKey:key,
      label:(selected===key?'[SELECTED] ':'')+seed.slice(0,23),
      state:`MASK ${mask.toString(16).toUpperCase()} F${favoriteCount}`});
  }
  if(selected && archives.some(c=>c.key===selected)){
    rows.push({kind:'archiveShare',key:'archiveShare',archiveKey:selected,
      label:'COPY SELECTED SEED + MASK',state:'SHARE'});
    rows.push({kind:'archiveConfirm',key:'archiveConfirm',archiveKey:selected,
      label:'CONFIRM DELETE SELECTED ARCHIVE',state:'ERASE'});
  }
  rows.push({kind:'static',key:'archiveNotice',label:String(o.notice||'SELECT COURSE FIRST; DELETION IS EXPLICIT').slice(0,58)});
  const texts=[];let y=8;
  for(const row of rows){
    row.y=y;
    if(row.kind==='head'){
      const w=measureText(row.right);
      row.texts=[{key:'archive-bank',text:row.right,x:SHOP_PANEL.w-PAD-w,y,w,h:GLYPH_H,color:'amber'}];
    }else{
      const label=String(row.label);
      const left=row.kind==='header'||row.kind==='static'?PAD:PAD+6;
      row.texts=[{key:row.key+'-label',text:label,x:left,y,w:measureText(label),h:GLYPH_H,
        color:row.kind==='archiveConfirm'?'danger':row.kind==='archiveEntry'?'cyan':'magenta'}];
      if(row.state){const w=measureText(row.state);row.texts.push({key:row.key+'-state',text:row.state,
        x:SHOP_PANEL.w-PAD-6-w,y,w,h:GLYPH_H,color:'amber'});}
    }
    texts.push(...row.texts);y+=ROW_H;
  }
  return {w:SHOP_PANEL.w,h:SHOP_PANEL.h,rows,texts,page,pageCount,rowH:ROW_H,
    band:{x:PAD-6,y:8,w:SHOP_PANEL.w-(PAD-6)*2}};
}

export { ROW_H as SHOP_ROW_H, GLYPH_H as SHOP_GLYPH_H };

// ---- SHOP-2: the TITLES screen (opened from the Profile view) -----------------------------------------

/** TITLES panel: narrower than the shop, one row per title plus the level-title DEFAULT row. */
export const TITLES_PANEL = Object.freeze({ w: 300 });

/**
 * The TITLES screen as one ordered list of rows, the same single-list rule as the shop.
 *
 * Rows: the BANK head; a DEFAULT row that names the level title ("LEVEL: PACKET JOCKEY") and puts the slot
 * back to DEFAULT; then one row per catalogue title. States are spelled out: EQUIPPED, EQUIP, a price,
 * ACHIEVEMENT (an achievement title not earned yet) or LVL n. Selecting EQUIPPED returns to DEFAULT, as
 * in the shop (SHOP-3).
 *
 * @param {{profile?:Object, levels?:Object}} o
 * @returns {{w:number,h:number,rows:Array,texts:Array,rowH:number,band:{x:number,y:number,w:number},bankText:string,firstSelectable:number}}
 */
export function titlesLayout(o = {}) {
  const profile = o.profile || {};
  const equipped = (profile.equipped && typeof profile.equipped === 'object') ? profile.equipped : {};
  const bank = Number.isFinite(profile.bank) ? profile.bank : 0;
  const table = loadLevelTable(o.levels);
  const level = levelForXp(Number(profile.xp) || 0, table);
  const entry = table.levels.find((e) => e.level === level) || { title: '' };
  const rows = [];
  const texts = [];
  const bankText = `BANK ${bank}`;
  rows.push({ kind: 'head', key: 'head', right: bankText });

  const items = SHOP_ITEMS.filter((i) => i && i.slot === 'title');
  const anyEquipped = items.some((it) => equipped.title === it.id || equipped.title === it.value);
  rows.push({
    kind: 'default', key: 'title-default', id: 'default', label: `LEVEL: ${upper(entry.title)}`,
    state: anyEquipped ? 'EQUIP' : 'EQUIPPED', equipped: !anyEquipped, disabled: false,
  });
  for (const it of items) {
    const owned = isOwned(profile, it.id);
    const isEquipped = equipped.title === it.id || equipped.title === it.value;
    const locked = !owned && it.grant !== 'achievement' && level < (it.unlockLevel || 1);
    let state;
    if (isEquipped) state = 'EQUIPPED';
    else if (owned) state = 'EQUIP';
    else if (it.grant === 'achievement') state = 'ACHIEVEMENT';
    else if (locked) state = `LVL ${it.unlockLevel}`;
    else state = String(it.price);
    const buyable = !owned && it.price > 0 && !locked && bank >= it.price;
    rows.push({
      kind: 'item', key: `title-${it.id}`, id: it.id, label: upper(it.name), state, owned, equipped: isEquipped,
      locked, price: it.price, disabled: !isEquipped && !owned && !buyable,
    });
  }

  let y = 8;
  let firstSelectable = -1;
  rows.forEach((r, i) => {
    r.y = y;
    r.index = i;
    if (r.kind === 'head') {
      const bw = measureText(r.right);
      r.texts = [{ key: 'head-right', text: r.right, x: TITLES_PANEL.w - PAD - bw, y, w: bw, h: GLYPH_H, color: 'amber' }];
    } else {
      if (firstSelectable < 0) firstSelectable = i;
      const rw = measureText(r.state);
      r.texts = [
        { key: `${r.key}-label`, text: r.label, x: PAD + 6, y, w: measureText(r.label), h: GLYPH_H, color: r.equipped ? 'lime' : 'text' },
        { key: `${r.key}-right`, text: r.state, x: TITLES_PANEL.w - PAD - 6 - rw, y, w: rw, h: GLYPH_H,
          color: r.equipped ? 'cyan' : (r.owned ? 'lime' : 'amber') },
      ];
    }
    for (const t of r.texts) texts.push(t);
    y += ROW_H;
  });
  return {
    w: TITLES_PANEL.w,
    h: y + 30,
    rows,
    texts,
    rowH: ROW_H,
    band: { x: PAD - 6, y: 8, w: TITLES_PANEL.w - (PAD - 6) * 2 },
    bankText,
    firstSelectable,
  };
}

/**
 * MenuList items for the TITLES screen: the same rows in the same order. The view attaches onSelect.
 * @param {Object} layout @returns {Array<Object>}
 */
export function titlesMenuItems(layout) {
  return layout.rows.map((r) => {
    if (r.kind === 'head') return { kind: 'static', label: '', rowKind: 'head', disabled: true };
    return { kind: 'action', rowKind: r.kind, id: r.id, label: r.label, sub: r.state, disabled: r.disabled, onSelect: null };
  });
}


/** Only referenced after real five-in-one-flight Gym mastery. No fallback
 * teaser exists in the normal Shop or permanent upgrades page. */
export function gymSetupLayout(o = {}) {
  const profile = o.profile || {};
  const bank = Number.isSafeInteger(profile.bank) ? profile.bank : 0;
  const setup = gymSetupForProfile(profile);
  const fields = [
    {id:'gapPx',label:'WALL GAP'},
    {id:'wallSpeedPxS',label:'WALL START SPEED'},
    {id:'launchHeightPx',label:'LAUNCH HEIGHT'},
    {id:'launchSpeedPxS',label:'START VELOCITY'},
    {id:'launchRisePxS',label:'UPWARD VELOCITY'},
  ];
  const rows = [
    {kind:'head',key:'head',label:'',right:'BANK '+bank},
    {kind:'gymSetupBack',key:'gymSetupBack',label:'← BACK TO UPGRADES'},
    {kind:'header',key:'gymSetupHead',label:'BSOD GYM / CUSTOM LAUNCH'},
    ...fields.map(f=>({kind:'gymSetupChoice',key:f.id,id:f.id,label:f.label,
      state:String(setup[f.id]),choices:GYM_SETUP_OPTIONS[f.id]})),
    {kind:'gymSetupStart',key:'gymSetupStart',label:'START PRACTICE'},
    {kind:'static',key:'gymSetupNote',label:'REAL PHYSICS / FORWARD-ONLY WALL'},
  ];
  return { w:SHOP_PANEL.w,h:SHOP_PANEL.h,rows,rowH:ROW_H,
    band:{x:PAD-6,y:8,w:SHOP_PANEL.w-(PAD-6)*2} };
}
