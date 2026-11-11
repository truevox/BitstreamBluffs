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
/** @typedef {{defId:string, x:number, y:number, rotationDeg:number}} HazardSpawn  y = ground surface height at x (sit on it). */
/** @typedef {{defId:string, x:number, y:number}} PowerUpSpawn  y = centre, already lifted above ground by the generator. */

/**
 * Hazard def (src/data/hazards/*.json).
 * @typedef {Object} HazardDef
 * @property {string} id
 * @property {string} shapeKey        key of the Graphics draw routine (gameplay entity switch), e.g. 'chasm'.
 * @property {{w:number,h:number}} size   collision box in px.
 * @property {{effect:'crash'|'slow'|'scramble', durationMs?:number, speedFactor?:number}} onHit
 * @property {number} weight          relative spawn weight.
 * @property {number} minDistanceM
 * @property {'ground'|'air'} placement
 * @property {string} colorKey        palette key (PALETTE_KEYS).
 */

/**
 * Power-up def (src/data/powerups/*.json).
 * @typedef {Object} PowerUpDef
 * @property {string} id
 * @property {string} shapeKey
 * @property {number} radius          pickup radius px.
 * @property {{kind:'slowmo'|'speedBoost'|'shield', durationMs?:number, timeScale?:number, speedFactor?:number, charges?:number}} effect
 * @property {{baseChance:number, distanceDecayM:number}} spawn  chance per candidate slot = baseChance / (1 + distanceM / distanceDecayM).
 * @property {string} colorKey
 */

/**
 * Terrain mod def (src/data/terrainMods/*.json). All multipliers default 1.
 * @typedef {Object} TerrainModDef
 * @property {'highBandwidth'|'compression'|'wirelessBridge'} id
 * @property {string} colorKey         telegraph colour (palette key).
 * @property {{frictionMul?:number, gravityMul?:number, bounceMul?:number}} physics
 * @property {number} weight
 * @property {number} minDistanceM
 * @property {[number,number]} lengthPx  min,max zone length.
 */
export {};
