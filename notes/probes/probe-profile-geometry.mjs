/**
 * Luna W3 audit probe — does the profile toggle menu clear the BACK button?
 *
 * The existing overlap test walks `overlappingPairs(items)` only. `toggleMenu` is returned as a
 * separate band and the BACK button is created inside `View`, so neither ever appears in that list:
 * the one collision the panel actually had was invisible to the helper that was supposed to catch it.
 * This probe reconstructs both boxes from the real numbers (ProfileLayout + Views.js View base) and
 * intersects them the same way `overlappingPairs` does.
 *
 * Pure arithmetic on exported constants + the real layout function, so it needs no Phaser.
 */
import { profileLayout, PROFILE_PANEL } from './src/ui/ProfileLayout.js';

/** `View`'s BACK button, in panel-local pixels. Mirrors src/ui/Views.js:41. */
const backButton = (h) => ({ key: 'BACK', x: PROFILE_PANEL.w - 76, y: h - 22, w: 68, h: 16 });

/** Intersection, identical rule to overlappingPairs: >1px on both axes counts. */
function overlaps(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { ix, iy, hit: ix > 1 && iy > 1 };
}

const BIOMES = ['debumont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern'];
const BIOME_ORDER = [
  ...BIOMES, 'space-mountain', 'candy-cane-canyon', 'sky-jellyfish-mountain',
  'steampunk-slopes', 'micro-mountain', 'vertigo-vents',
];

// Worst case the UI can actually present: a capped pilot with every shipped signature reached,
// so all five toggle rows exist and no plain name row is suppressed by being playable.
const levels = {
  cap: 30,
  biomeOrder: BIOME_ORDER,
  levels: Array.from({ length: 30 }, (_, i) => ({ level: i + 1, xpMin: i * 1000, title: `T${i + 1}` })),
};
const profile = { xp: 99999, level: 30, pendingBiomes: [...BIOME_ORDER], biomeMask: 31 };

const canvasH = 270;
const panelY = 22; // Views.js: Panel y: 22

for (const h of [224, 240]) {
  const saved = PROFILE_PANEL.h;
  // profileLayout reads the frozen constant, so drive the two heights explicitly instead of mutating it.
  const layout = profileLayout({ profile, levels, playableBiomeIds: BIOMES });
  const H = h === 224 ? saved : h;
  const band = layout.toggleMenu;
  const rows = layout.toggleRowCount;
  const menuBottom = band.y + rows * band.rowH;
  const back = backButton(H);
  const r = overlaps({ x: band.x, y: band.y, w: band.w, h: rows * band.rowH }, back);
  const panelBottom = panelY + H;

  console.log(`\n--- PROFILE_PANEL.h = ${H} ---`);
  console.log(`  toggle rows        : ${rows}  (rowH ${band.rowH})`);
  console.log(`  menu band          : y ${band.y} .. ${menuBottom}`);
  console.log(`  BACK button        : y ${back.y} .. ${back.y + back.h}`);
  console.log(`  overlap            : ${r.hit ? `YES ${r.ix}x${r.iy}px` : 'none'}`);
  console.log(`  panel bottom       : ${panelBottom} (canvas ${canvasH}) ${panelBottom <= canvasH ? 'fits' : 'OVERFLOWS'}`);
  console.log(`  SIGNAL             : ${r.hit ? 'RED - last toggle row is inside BACK' : 'GREEN - clears BACK'}`);
}
