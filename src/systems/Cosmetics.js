/**
 * W4 cosmetics — turn the equipped items into the colours the sled, glow and trail are drawn with.
 *
 * WHY THIS IS A SEPARATE MODULE. `Sled.js` is a Phaser entity and cannot be imported by a test; the shop
 * data lives in ProfileStore. The decision "which hue does the player actually see" is pure, so it lives
 * here where it can be tested, and the entity just reads the answer. That is the same split W3 used for
 * palette overrides, and it is why a cosmetic bug can be caught without launching the game.
 *
 * THE SAFETY RULE. Spec W4: "colorblind mode keeps overriding anything that would reduce hazard contrast".
 * A cosmetic that recolours the rider is decoration; a cosmetic that recolours a hazard is a gameplay bug
 * wearing a hat. So under a colourblind palette every cosmetic is REFUSED wholesale rather than merged -
 * merging would let one hue slip through and defeat the setting the player chose for safety.
 */

/**
 * THE cosmetic catalogue (audit F4b). This is the one source of truth: ProfileStore.SHOP_ITEMS is this same
 * array, the resolver's id lookup below is derived from it, and data/cosmetics/cosmetics.json is a mirror
 * that tests/src/cosmetics-complete.test.js pins field by field. It is a JS constant rather than the JSON
 * because pure modules and Jest (ESM, no transform) cannot import a .json file.
 *
 * Fields:
 *   id          stable id, what `unlocked.cosmetics` and levels.json `cosmetic` hold
 *   kind        what it changes; equals `slot` for every cosmetic (glow is "glow", never "sledGlow")
 *   slot        the `profile.equipped` key it equips into (trail/glow/rider/theme/title)
 *   name        shop label
 *   price       Data Shards; 0 = never bought (a level reward or an achievement grant)
 *   unlockLevel price 0: the level that grants it; price > 0: the level it can first be bought at
 *   value       what `equip()` stores in the slot; unique within a slot
 *   grant       optional; 'achievement' = owned only when an achievement put `value` in `unlocked.titles`
 * @type {ReadonlyArray<Readonly<{id:string,kind:string,slot:string,name:string,price:number,unlockLevel:number,value:string,grant?:string}>>}
 */
export const COSMETIC_ITEMS = Object.freeze([
  { id: 'trail-hue-aurora', kind: 'trail', slot: 'trail', name: 'Aurora Trail', price: 0, unlockLevel: 3, value: 'aurora' },
  { id: 'trail-hue-ember', kind: 'trail', slot: 'trail', name: 'Ember Trail', price: 120, unlockLevel: 1, value: 'ember' },
  { id: 'trail-hue-tidal', kind: 'trail', slot: 'trail', name: 'Tidal Trail', price: 200, unlockLevel: 5, value: 'tidal' },
  { id: 'sled-glow-warm', kind: 'glow', slot: 'glow', name: 'Warm Glow', price: 90, unlockLevel: 1, value: 'warm' },
  { id: 'sled-glow-cold', kind: 'glow', slot: 'glow', name: 'Cold Glow', price: 150, unlockLevel: 4, value: 'cold' },
  { id: 'rider-hue-mint', kind: 'rider', slot: 'rider', name: 'Mint Rider', price: 100, unlockLevel: 1, value: 'mint' },
  { id: 'rider-hue-plum', kind: 'rider', slot: 'rider', name: 'Plum Rider', price: 180, unlockLevel: 6, value: 'plum' },
  { id: 'theme-mono', kind: 'theme', slot: 'theme', name: 'Mono Theme', price: 250, unlockLevel: 1, value: 'mono' },
  { id: 'theme-sunset', kind: 'theme', slot: 'theme', name: 'Sunset Theme', price: 300, unlockLevel: 8, value: 'sunset' },
  // Level rewards (audit F4): levels.json grants these on level-up. Price 0, unlockLevel = the granting
  // level, so isOwned() owns them from that level on; colours are the palette's own neon hues.
  { id: 'trail-cyan', kind: 'trail', slot: 'trail', name: 'Cyan Trail', price: 0, unlockLevel: 2, value: 'cyan' },
  { id: 'glow-lime', kind: 'glow', slot: 'glow', name: 'Lime Glow', price: 0, unlockLevel: 5, value: 'lime' },
  { id: 'rider-amber', kind: 'rider', slot: 'rider', name: 'Amber Rider', price: 0, unlockLevel: 9, value: 'amber' },
  { id: 'theme-magenta', kind: 'theme', slot: 'theme', name: 'Magenta Theme', price: 0, unlockLevel: 12, value: 'magenta' },
  { id: 'trail-magenta', kind: 'trail', slot: 'trail', name: 'Magenta Trail', price: 0, unlockLevel: 15, value: 'magenta' },
  { id: 'glow-cyan', kind: 'glow', slot: 'glow', name: 'Ice Cyan Glow', price: 0, unlockLevel: 18, value: 'cyan' },
  { id: 'rider-lime', kind: 'rider', slot: 'rider', name: 'Lime Rider', price: 0, unlockLevel: 20, value: 'lime' },
  { id: 'theme-amber', kind: 'theme', slot: 'theme', name: 'Amber Theme', price: 0, unlockLevel: 23, value: 'amber' },
  { id: 'trail-amber', kind: 'trail', slot: 'trail', name: 'Amber Trail', price: 0, unlockLevel: 26, value: 'amber' },
  { id: 'glow-magenta', kind: 'glow', slot: 'glow', name: 'Magenta Glow', price: 0, unlockLevel: 29, value: 'magenta' },
  { id: 'theme-legend', kind: 'theme', slot: 'theme', name: 'Legend Theme', price: 0, unlockLevel: 30, value: 'legend' },
  { id: 'title-rookie', kind: 'title', slot: 'title', name: 'Rookie', price: 0, unlockLevel: 1, value: 'ROOKIE' },
  { id: 'title-static', kind: 'title', slot: 'title', name: 'Static Rider', price: 220, unlockLevel: 1, value: 'STATIC RIDER' },
].map((i) => Object.freeze(i)));

/**
 * The hue table, keyed by catalogue `kind`, then by item `value`.
 *
 * `trail` hues are four-stop gradients because the trail already colours by speed (cyan -> lime -> amber
 * -> magenta); replacing one stop would fight that gradient, so a trail hue replaces all four.
 * `sledGlow` is kept as a non-enumerable alias of `glow` for older callers; the catalogue kind is `glow`.
 * @type {Object<string,Object<string,Object>>}
 */
const HUES = {
  rider: Object.freeze({
    mint: Object.freeze({ color: '#5cffb0' }),
    plum: Object.freeze({ color: '#c060ff' }),
    amber: Object.freeze({ color: '#ffb000' }), // palette amber (level 9)
    lime: Object.freeze({ color: '#9dff3a' }), // palette lime (level 20)
  }),
  glow: Object.freeze({
    warm: Object.freeze({ color: '#ffc46b' }),
    cold: Object.freeze({ color: '#7fd0ff' }),
    lime: Object.freeze({ color: '#9dff3a' }), // palette lime (level 5)
    // Level 18. The DEFAULT glow is palette cyan (#00f0ff), so a literal cyan reward would change nothing on
    // screen. This is a paler, icier cyan: still reads as cyan, visibly not the default, and not Cold Glow.
    cyan: Object.freeze({ color: '#a8fcff' }),
    magenta: Object.freeze({ color: '#ff2bd6' }), // palette magenta (level 29)
  }),
  trail: Object.freeze({
    aurora: Object.freeze({ stops: Object.freeze(['#5cffb0', '#00f0ff', '#7fd0ff', '#c060ff']) }),
    ember: Object.freeze({ stops: Object.freeze(['#ffb020', '#ff7a30', '#ff4d2e', '#ffd66b']) }),
    tidal: Object.freeze({ stops: Object.freeze(['#0d9bd6', '#00f0ff', '#5cffb0', '#0a4f8a']) }),
    // Level rewards: one hue, deep at low speed to white-hot at top speed, so the speed read survives.
    cyan: Object.freeze({ stops: Object.freeze(['#0a7fa0', '#00c8e6', '#00f0ff', '#b8fbff']) }),
    magenta: Object.freeze({ stops: Object.freeze(['#8a1f9e', '#c824c8', '#ff2bd6', '#ffb8f0']) }),
    amber: Object.freeze({ stops: Object.freeze(['#a05a00', '#e08a00', '#ffb000', '#ffe6a0']) }),
  }),
  theme: Object.freeze({
    mono: Object.freeze({ color: '#c8d4e0' }),
    sunset: Object.freeze({ color: '#ff7a5c' }),
    magenta: Object.freeze({ color: '#ff2bd6' }),
    amber: Object.freeze({ color: '#ffb000' }),
    legend: Object.freeze({ color: '#ffd66b' }),
  }),
};
Object.defineProperty(HUES, 'sledGlow', { value: HUES.glow, enumerable: false });
export const COSMETIC_HUES = Object.freeze(HUES);

/** Cosmetic id -> catalogue entry, derived from COSMETIC_ITEMS so it cannot disagree with the shop. */
const CATALOGUE = Object.freeze(Object.fromEntries(
  COSMETIC_ITEMS.map((i) => [i.id, Object.freeze({ kind: i.kind, slot: i.slot, value: i.value })]),
));

/**
 * The catalogue entry a SLOT holds, matched by id or by equipped value but only within that slot.
 *
 * Values repeat across slots ('cyan' is a trail, a glow and a theme), so a slot-blind lookup by value would
 * hand the glow slot the trail entry and the item would render as missing.
 * @param {string} slot @param {string} idOrValue @returns {{kind:string,slot:string,value:string,id:string}|null}
 */
export function cosmeticInSlot(slot, idOrValue) {
  if (typeof idOrValue !== 'string' || !idOrValue) return null;
  const direct = CATALOGUE[idOrValue];
  if (direct && direct.slot === slot) return { ...direct, id: idOrValue };
  for (const [id, entry] of Object.entries(CATALOGUE)) {
    if (entry.slot === slot && entry.value === idOrValue) return { ...entry, id };
  }
  return null;
}

/**
 * Resolve a catalogue entry by ID **or by equipped value**.
 *
 * Both are needed because `ProfileStore.equip()` stores the item's `value` ('mint'), not its id
 * ('rider-hue-mint'), so an item equipped through the shop arrives here as 'mint' while one written by
 * hand or by a test arrives as the id. Accepting only the id meant a shop-equipped cosmetic silently
 * refused to render — exactly the "tests green, feature invisible" failure this module exists to prevent.
 * @param {string} idOrValue @returns {{kind:string,slot:string,value:string,id?:string}|null}
 */
export function cosmeticFor(idOrValue) {
  if (typeof idOrValue !== 'string' || !idOrValue) return null;
  const direct = CATALOGUE[idOrValue];
  if (direct) return { ...direct, id: idOrValue };
  for (const [id, entry] of Object.entries(CATALOGUE)) {
    // `value` is only unique within a slot ('cyan' is a trail, a glow and a theme), so a bare value returns
    // the first match. Callers that know the slot use cosmeticInSlot(), which the resolver does.
    if (entry.value === idOrValue) return { ...entry, id };
  }
  return null;
}

/**
 * Resolve a profile's equipped cosmetics into drawable colours.
 *
 * Pure. Returns hex strings because the entity-side callers convert to ints where they need to; the
 * palette is passed in both forms so this never reaches into Phaser or the content loader.
 *
 * @param {Object|null} profile the profile (may be absent / mid-migration)
 * @param {Object} palette the active palette as ints (0xRRGGBB)
 * @param {Object<string,string>} paletteHex the same palette as '#rrggbb' strings
 * @param {{colorblind?:boolean}} [o]
 * @returns {{rider:string, glow:string, trail:string[], theme:string, danger:string,
 *            overridden:boolean, missing:string[]}}
 */
export function resolveCosmetics(profile, palette, paletteHex, o = {}) {
  const hex = paletteHex || {};
  const colorblind = Boolean(o && o.colorblind);
  const equipped = (profile && profile.equipped && typeof profile.equipped === 'object') ? profile.equipped : {};

  // Pre-W4 defaults, straight off the palette, so an unequipped profile renders exactly as it used to.
  const base = {
    rider: hex.magenta,
    glow: hex.cyan,
    trail: [hex.cyan, hex.lime, hex.amber, hex.magenta],
    theme: 'default',
  };

  if (colorblind) {
    return { ...base, danger: hex.danger, overridden: true, missing: [] };
  }

  const missing = [];
  const out = { ...base };

  /** Look up the equipped id for a slot, recording ids this build cannot draw. */
  const lookup = (slot) => {
    const id = equipped[slot];
    if (!id || id === 'default') return null;
    // Match within the slot: `equip()` writes a bare value ('mint'), so a value that exists in two slots
    // must resolve to the one this slot draws.
    const entry = cosmeticInSlot(slot, id);
    if (!entry) { missing.push(id); return null; }
    const hue = COSMETIC_HUES[entry.kind] && COSMETIC_HUES[entry.kind][entry.value];
    if (!hue) { missing.push(id); return null; }
    return { entry, hue };
  };

  const rider = lookup('rider');
  if (rider) out.rider = rider.hue.color;

  const glow = lookup('glow');
  if (glow) out.glow = glow.hue.color;

  const trail = lookup('trail');
  if (trail && Array.isArray(trail.hue.stops)) out.trail = trail.hue.stops.slice();

  // The theme name is reported for the UI to apply; it never recolours hazards, and in colourblind mode
  // it is refused above with everything else.
  const theme = lookup('theme');
  if (theme) out.theme = theme.entry.value;

  return { ...out, danger: hex.danger, overridden: false, missing };
}
