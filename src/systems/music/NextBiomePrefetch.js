/** Browser-safe pure next-biome lookahead. Never initiates a transfer. */
import {BIOME_IDS,HOME_BIOME} from './BiomeVoices.js';
const MENU_BIOME='debutmont';
const ALL_BIOMES=new Set(BIOME_IDS.filter(id=>id!==HOME_BIOME));
export function upcomingBiomePrefetch({currentLevel,biomeDefs,unlockedBiomeIds=[]}={}){
 if(!Number.isFinite(currentLevel)||currentLevel<0||!Array.isArray(biomeDefs)||!Array.isArray(unlockedBiomeIds))throw new TypeError('Current level and biome table required');
 const unlocked=new Set();for(const id of unlockedBiomeIds){if(!ALL_BIOMES.has(id))throw new Error('Unknown biome: '+id);unlocked.add(id);}
 const candidates=biomeDefs.filter(x=>x&&ALL_BIOMES.has(x.id)&&x.id!==MENU_BIOME&&!unlocked.has(x.id)&&Number.isSafeInteger(x.unlockLevel)&&x.unlockLevel>currentLevel)
  .sort((a,b)=>a.unlockLevel-b.unlockLevel||a.id.localeCompare(b.id));
 return candidates.length?[candidates[0].id]:[];
}
