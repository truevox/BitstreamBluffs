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
 * The hue table. `kind` matches a catalogue item's `kind`; each entry is what that hue does.
 *
 * `trail` hues are four-stop gradients because the trail already colours by speed (cyan -> lime -> amber
 * -> magenta); replacing one stop would fight that gradient, so a trail hue replaces all four.
 * @type {Object<string,Object<string,Object>>}
 */
export const COSMETIC_HUES = Object.freeze({
  rider: Object.freeze({
    mint: Object.freeze({ color: '#5cffb0' }),
    plum: Object.freeze({ color: '#c060ff' }),
  }),
  sledGlow: Object.freeze({
    warm: Object.freeze({ color: '#ffc46b' }),
    cold: Object.freeze({ color: '#7fd0ff' }),
  }),
  trail: Object.freeze({
    aurora: Object.freeze({ stops: Object.freeze(['#5cffb0', '#00f0ff', '#7fd0ff', '#c060ff']) }),
    ember: Object.freeze({ stops: Object.freeze(['#ffb020', '#ff7a30', '#ff4d2e', '#ffd66b']) }),
    tidal: Object.freeze({ stops: Object.freeze(['#0d9bd6', '#00f0ff', '#5cffb0', '#0a4f8a']) }),
  }),
  theme: Object.freeze({
    mono: Object.freeze({ color: '#c8d4e0' }),
    sunset: Object.freeze({ color: '#ff7a5c' }),
  }),
});

/** Cosmetic id -> catalogue entry, built once. Kept here so the resolver needs no data loader. */
const CATALOGUE = Object.freeze({
  'trail-hue-aurora': { kind: 'trail', slot: 'trail', value: 'aurora' },
  'trail-hue-ember': { kind: 'trail', slot: 'trail', value: 'ember' },
  'trail-hue-tidal': { kind: 'trail', slot: 'trail', value: 'tidal' },
  'sled-glow-warm': { kind: 'sledGlow', slot: 'glow', value: 'warm' },
  'sled-glow-cold': { kind: 'sledGlow', slot: 'glow', value: 'cold' },
  'rider-hue-mint': { kind: 'rider', slot: 'rider', value: 'mint' },
  'rider-hue-plum': { kind: 'rider', slot: 'rider', value: 'plum' },
  'theme-mono': { kind: 'theme', slot: 'theme', value: 'mono' },
  'theme-sunset': { kind: 'theme', slot: 'theme', value: 'sunset' },
  'title-rookie': { kind: 'title', slot: 'title', value: 'ROOKIE' },
  'title-static': { kind: 'title', slot: 'title', value: 'STATIC RIDER' },
});

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
    // `value` is only unique within a slot, so this can only be used when the caller knows the slot.
    // Returning the first match is safe for the single-owner slots the game ships (rider/glow/trail/theme
    // never share a value across kinds); a future clash would be caught by the uniqueness test.
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
    // Match within the slot's own kind: `equip()` writes a bare value ('mint'), so a value that exists in
    // two kinds must resolve to the one this slot draws.
    const entry = cosmeticFor(id) || Object.entries(CATALOGUE)
      .filter(([, e]) => e.slot === slot && e.value === id)
      .map(([cid, e]) => ({ ...e, id: cid }))[0] || null;
    if (!entry || entry.slot !== slot) { if (id) missing.push(id); return null; }
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
