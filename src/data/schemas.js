/**
 * JSDoc typedefs for JSON content + generated terrain. FOUNDATION-OWNED, type-only (no runtime code).
 * Contract: see src/ARCHITECTURE.md sections 3 and 5.
 */

/**
 * Chunk TEMPLATE (src/data/chunks/*.json). The generator instantiates templates into TerrainChunks.
 * @typedef {Object} ChunkDef
 * @property {string} id
 * @property {'spline'|'noise'|'bridge'} kind  spline = bezier segment pack, noise = 1-D noise zone, bridge = gap with bounce pads.
 * @property {number} weight                  relative pick weight.
 * @property {number} minDistanceM            earliest distance (m) this template may appear.
 * @property {number} [maxDistanceM]          optional latest distance.
 * @property {number} lengthPx                nominal horizontal length (generator may scale +-20%).
 * @property {{x:number,y:number}[]} [controlPoints]  spline kind: bezier control points in LOCAL space, x in [0,1] of length,
 *                                            y in px relative to chunk start (positive = downhill). Seeded jitter applied on top.
 * @property {{amplitudePx:number,frequency:number,octaves:number,meanSlopeDeg:number}} [noise]  noise kind params.
 * @property {{gapPx:number,bounceBoost:number}} [bridge]  bridge kind params.
 * @property {string[]} [tags]
 * @property {string[]} [modIds]              terrain mods that may be applied (zone placed over a sub-range).
 */

/**
 * Generated terrain chunk. THE shape the gameplay engineer renders/collides.
 * World coords: x increases rightwards (downhill), y increases DOWNWARDS, pixels. Continuous across chunk borders
 * (chunk[i].points.last === chunk[i+1].points.first).
 * @typedef {Object} TerrainChunk
 * @property {number} index        0-based chunk index along the track (stable id for pooling).
 * @property {string} defId        template id it was built from.
 * @property {'spline'|'noise'|'bridge'} kind
 * @property {number} startX       world px, == points[0].x
 * @property {number} endX         world px, == points[points.length-1].x
 * @property {{x:number,y:number}[]} points  polyline, x strictly increasing, spacing within [TERRAIN.minPointSpacingPx, maxPointSpacingPx].
 * @property {TerrainZone[]} zones           terrain-mod zones overlapping this chunk (x ranges clipped to chunk).
 * @property {GapSpan[]} gaps                spans where the segment between two points is NOT solid (wireless bridge gaps).
 * @property {BouncePad[]} bouncePads
 * @property {HazardSpawn[]} hazards
 * @property {PowerUpSpawn[]} powerups
 * @property {ShardSpawn[]} shards      fun pass: collectibles, sorted by x, ids `s<chunkIndex>-<n>` unique and stable per seed (may be empty).
 * @property {LaunchInfo[]} launches    fun pass: ballistic launch points at the expected speed (may be empty).
 * @property {number} sector            fun pass: 1-based 500 m sector of startX.
 * @property {boolean} breather         fun pass: first (calm, partly hazard-free) chunk of a sector.
 */

/** @typedef {{id:string, x:number, y:number}} ShardSpawn  world px, centre; always above the surface and clear of hazards. */
/** @typedef {{x:number, y:number, angleDeg:number, airS:number, landX:number|null}} LaunchInfo  landX null = lands beyond the chunk. */

/** @typedef {{modId:'highBandwidth'|'compression'|'wirelessBridge', x0:number, x1:number}} TerrainZone  world px, x0<x1. */
/** @typedef {{x0:number, x1:number}} GapSpan  both x values coincide with polyline points; no collider/mesh between them. */
/** @typedef {{x:number, y:number, width:number, boost:number}} BouncePad  y = ground surface at x; boost = upward speed px/s. */
/** @typedef {{defId:string, x:number, y:number, rotationDeg:number, phase?:number}} HazardSpawn  B3 (additive): `phase` (0..1, rounded to 1e-6) is set ONLY on a Gear Gate (def.motion.kind 'gate'): where in its open/closed cycle the gate starts, from the slot's own pre-drawn number so no seeded stream moves (TerrainGenerator.biomeSpawn). Other spawns have no `phase`. Ground hazards: y = ground surface height at x (sit on it). Air hazards (def.placement 'air'): y = CENTRE of the box, floating in a jump arc, rotationDeg 0. */
/** @typedef {{defId:string, x:number, y:number}} PowerUpSpawn  y = centre, already lifted above ground by the generator. */

/**
 * Hazard def (src/data/hazards/*.json).
 * @typedef {Object} HazardDef
 * @property {string} id
 * @property {string} [name]          player-facing name (additive; today Meteor, Gust Front). The crash banner / Game Over line
 *                                    use it upper-cased; a def without one is named from its camelCase id (systems/CrashReport.killerName).
 * @property {string} shapeKey        key of the Graphics draw routine (gameplay entity switch), e.g. 'chasm'.
 * @property {{w:number,h:number}} size   collision box in px.
 * @property {{effect:'crash'|'slow'|'scramble'|'blind'|'gust', durationMs?:number, speedFactor?:number,
 *             visibility?:number, impulsePxS?:[number,number]}} onHit
 *                                    B0 (additive): 'blind' {durationMs?, visibility?} dims the screen (never below 35 %
 *                                    visibility, no crash); 'gust' {impulsePxS:[x,y]} is one velocity kick, at most 180 px/s.
 *                                    Math in systems/BiomeEffects.js.
 * @property {number} weight          relative spawn weight (biome defs: 0 disables the def).
 * @property {number} minDistanceM
 * @property {'ground'|'air'} placement   'air' = floats at spawn.y (centre) inside the flight arc of a generated jump, at most one per jump, see ARCHITECTURE.md "Air hazards".
 * @property {string} colorKey        palette key (PALETTE_KEYS). A BIOME crash hazard is always drawn in `danger`.
 * @property {string} [biome]         B0 (additive): biome id. A def with this field never enters the base hazard lists;
 *                                    it spawns only in that biome's chunks (TerrainGenerator._placeBiomeSpawns).
 * @property {{baseChance:number}} [spawn]  B0, biome defs only: chance of the chunk's biome hazard slot, capped at 0.5.
 * @property {{kind:'roll', speedPxS?:number, rangePx?:number, dir?:1|-1}|{kind:'gate', periodMs?:number, openMs?:number}} [motion]
 *                                    B3 (additive): a moving ground hazard (systems/HazardMotion.js; every number is clamped to its bounds).
 *                                    'roll' (Rolling Boulder, Dew Drop): rolls along the slope up to `speedPxS` (<= 120) across a track
 *                                    `rangePx` (<= 200) long; `dir` +1 (default) rolls downhill, away from the sled, -1 uphill.
 *                                    'gate' (Gear Gate): open for `openMs`, closed for the rest of each `periodMs` (defaults 900 / 1400),
 *                                    offset by the spawn's `phase`. Absent = the hazard stands still.
 * @property {number} [maxDistanceM]  optional upper distance bound.
 */

/**
 * Power-up def (src/data/powerups/*.json).
 * @typedef {Object} PowerUpDef
 * @property {string} id
 * @property {string} shapeKey
 * @property {number} radius          pickup radius px.
 * @property {{kind:'slowmo'|'speedBoost'|'shield'|'ward'|'glide'|'stabilize'|'magnet', durationMs?:number, timeScale?:number,
 *             speedFactor?:number, charges?:number, mods?:string[], hazards?:string[], effects?:string[],
 *             frictionMul?:number, landingToleranceDeg?:number, bounceMul?:number}} effect
 *                                    B0 kinds (additive): 'ward' {durationMs (4-6 s), mods[], hazards[], effects[]} switches
 *                                    off those terrain-mod ids, hazard ids and hazard effects (systems/Wards.js); 'glide'
 *                                    {frictionMul, durationMs} multiplies ground friction; 'stabilize' {landingToleranceDeg,
 *                                    bounceMul?, durationMs} widens landing tolerance (systems/BiomeEffects.js).
 *                                    Shipped shapes: ward {durationMs: 4000-6000, mods|hazards|effects lists, optional speedFactor
 *                                    (Slick Wax Spray, 1.1)}; glide {frictionMul 0.3 | 0.55, durationMs 2000 | 5000}; stabilize
 *                                    {landingToleranceDeg 12, bounceMul? 0.5 (Stabilizer Rails only), durationMs 5000}.
 * @property {{baseChance:number, distanceDecayM:number}} spawn  chance per candidate slot = max(0.4 x baseChance, baseChance / (1 + distanceM / distanceDecayM)).
 *                                    Biome defs: baseChance alone, capped at 0.5 (no distance decay).
 * @property {string} colorKey
 * @property {string} [biome]         B0 (additive): biome id. A def with this field never enters the base power-up list; it
 *                                    spawns only in that biome's chunks, one slot per chunk. Ranked; never sets `modded`.
 */

/**
 * Terrain mod def (src/data/terrainMods/*.json). All physics multipliers default 1.
 *
 * `physics` may be empty. W3's Crystal Cavern needs an echo zone whose mechanic is "tricks landed
 * inside score a combo bonus", which is not expressible as any of the three physics multipliers, so the
 * mod carries `scoreMul` instead. A mod must declare at least one of `physics` or `scoreMul`, or it is
 * a zone the player cannot feel; `data.test.js` enforces that.
 *
 * @typedef {Object} TerrainModDef
 * @property {string} id              camelCase, e.g. 'highBandwidth', 'stickyPatch', 'echoZone'.
 * @property {string} colorKey         telegraph colour (palette key).
 * @property {{frictionMul?:number, gravityMul?:number, bounceMul?:number, speedMul?:number,
 *             steerMul?:number, pushForceMul?:number, landingRebound?:number}} [physics]
 *                                    `landingRebound` (additive, B4): the share of a scored touchdown's impact speed
 *                                    returned as a slope-normal rebound (BiomeEffects.springRebound; below its 120 px/s
 *                                    floor there is no rebound). Overlapping zones take the larger share; the Stabilizer
 *                                    Rails scale it by bounceMul squared.
 * @property {number} [scoreMul]      W3: multiplier on banked trick points inside the zone, >= 1.
 *                                    Never applies to the flat perfect-landing bonus or to distance.
 * @property {{amplitudePx:number, periodPx:number, taperPx?:number}} [terrainSwell]
 *                                    W6: periodic terrain swells (Micro Mountain's rolling dew drops).
 *                                    Bounded so the surface can never invert or bury the sled.
 *                                    T2: displaces the chunk points (the collider); taperPx is the raised-cosine
 *                                    ramp at each zone edge (additive, optional).
 * @property {{velocityPxS:number, cooldownMs:number}} [launch]
 *                                    W6: upward kicks from the ground (Vertigo Vents' geysers). Cooldown
 *                                    prevents a vent from re-firing on the same contact every frame.
 * @property {number} weight
 * @property {number} minDistanceM
 * @property {[number,number]} [lengthPx]  min,max zone length.
 */

/**
 * Biome def (src/data/biomes/*.json). W3 batch 1; additive to the content set.
 *
 * A biome is a masked sector of ordinary terrain with one signature mechanic, a palette tint and a
 * background motif. It is not a separate generator: `biomeForSector` decides which biome (if any) owns a
 * sector, and the sector is then built from the normal chunk templates plus this biome's mod zone.
 *
 * @typedef {Object} BiomeDef
 * @property {string} id            kebab-case, e.g. 'garbage-dump-glacier'.
 * @property {number} bit           power-of-two mask bit. This is the vocabulary of `profile.biomeOff`
 *                                  and of the date-derived Daily mask, so it is assigned by CONTENT and
 *                                  must never be inferred from a position in `levels.json: biomeOrder`.
 * @property {string} name          player-facing name.
 * @property {number} unlockLevel   Sync Level that grants it; must agree with `levels.json`.
 * @property {string} lore          one-line flavour text.
 * @property {string} background    background motif id (see `Background.js`).
 * @property {string} mod           `.id` of exactly ONE `TerrainModDef` - D2 allows one signature
 *                                  mechanic per biome. Note this is a camelCase terrainMod id
 *                                  ('echoZone'), not a kebab-case file name.
 * @property {string[]} chunks      2-3 chunk template ids this sector PREFERS. A preference, not a
 *                                  filter: an ineligible template falls back to ordinary terrain.
 * @property {Object<string, Object<string,string>>} palettes  palette name -> partial overrides,
 *                                  merged over the ACTIVE palette. Partial so colour-blind keys the
 *                                  biome does not name survive. `danger` is never overridable.
 */

/**
 * Cosmetic catalogue entry (systems/Cosmetics.js COSMETIC_ITEMS is the source of truth; data/cosmetics/cosmetics.json mirrors it).
 * @typedef {Object} CosmeticDef
 * @property {string} id              stable id, what `unlocked.cosmetics` and levels.json `cosmetic` hold.
 * @property {string} kind            what it changes; equals `slot`.
 * @property {'trail'|'glow'|'rider'|'theme'|'title'} slot  the `profile.equipped` key it equips into.
 * @property {string} name            shop label.
 * @property {number} price           Data Shards; 0 = never bought (level reward, achievement or biome grant).
 * @property {number} unlockLevel     price 0: the level that grants it; price > 0: the level it can first be bought at.
 * @property {string} value           what equip() stores in the slot; unique within a slot.
 * @property {'achievement'|'biome'} [grant]  additive: 'achievement' = owned only when an achievement put `value` in
 *                                    `unlocked.titles`; 'biome' = owned only when `biome` is in `biomeProgress.completed`
 *                                    (or ProfileStore.creditRun wrote the id into `unlocked.cosmetics`).
 * @property {string} [biome]         grant 'biome' only: the biome id whose completion earns it.
 * @property {string} [unlockText]    grant 'biome' only: the shop's locked-state text (the condition spelled out).
 */

/**
 * REG.LAST_CRASH: the last run-ending crash. Registry only, never in the RunRecord or its ledger hash. Built by
 * systems/CrashReport.crashReport; read by GameOverScene (header line) and RunScene (DIED HERE on a same-seed, same-mask retry).
 * @typedef {Object} LastCrash
 * @property {string|null} runId      RunRecord.id of the run that crashed (Game Over shows the line only for that run).
 * @property {string} seed
 * @property {number} biomeMask
 * @property {number} x               world px of the crash (the DIED HERE pole).
 * @property {number} distM           metres at the crash.
 * @property {string} cause           'hazard' | 'terrain' | 'badLanding' | 'chasm'.
 * @property {string|null} hazardId   the killing hazard's def id for a hazard crash, else null.
 * @property {string} name            killer name, upper case.
 * @property {string} verdict         hop verdict ('' when not a hazard crash), e.g. 'HOP WAS 0.21 S LATE'.
 * @property {string} line            Game Over header line, e.g. 'PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE'.
 */
export {};
