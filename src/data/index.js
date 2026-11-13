/**
 * Content loader. FOUNDATION-OWNED (public signature is a contract - see src/ARCHITECTURE.md).
 * Uses Vite `import.meta.glob`, so it is NOT importable from Jest. Pure-logic modules take content
 * by constructor injection; only services.js / scenes import this file.
 * New JSON dropped into a data folder is picked up automatically at boot (design doc section 11).
 */
import palettes from './palettes.json';
import levels from './progression/levels.json';
import missions from './missions/missions.json';

const chunkFiles = import.meta.glob('./chunks/*.json', { eager: true, import: 'default' });
const hazardFiles = import.meta.glob('./hazards/*.json', { eager: true, import: 'default' });
const powerupFiles = import.meta.glob('./powerups/*.json', { eager: true, import: 'default' });
const modFiles = import.meta.glob('./terrainMods/*.json', { eager: true, import: 'default' });
const biomeFiles = import.meta.glob('./biomes/*.json', { eager: true, import: 'default' });

/**
 * @typedef {Object} Content
 * @property {import('./schemas.js').ChunkDef[]} chunks            all chunk templates (spline packs + noise zones).
 * @property {Object<string, import('./schemas.js').HazardDef>} hazards   by def id.
 * @property {Object<string, import('./schemas.js').PowerUpDef>} powerups by def id.
 * @property {Object<string, import('./schemas.js').TerrainModDef>} terrainMods by mod id.
 * @property {Object<string, import('./schemas.js').BiomeDef>} biomes     by biome id (W3). Additive.
 * @property {Object<string, Object<string,string>>} palettes      palette name -> { key: '#rrggbb' }.
 * @property {Object} progression   Sync Level table (levels.json): {cap, levels[], biomeOrder[]}. Additive.
 * @property {Object} missions      W2 mission templates (missions.json): {templates[]}. Additive.
 */

const byId = (files) =>
  Object.fromEntries(Object.values(files).map((d) => [d.id, d]));

/**
 * Collect every JSON def. Called once from createServices().
 * @returns {Content}
 */
export function loadContent() {
  return {
    chunks: Object.values(chunkFiles),
    hazards: byId(hazardFiles),
    powerups: byId(powerupFiles),
    terrainMods: byId(modFiles),
    biomes: byId(biomeFiles),
    palettes,
    progression: levels,
    missions,
  };
}
