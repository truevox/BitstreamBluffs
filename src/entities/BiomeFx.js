/**
 * OWNER: gameplay engineer.
 * #65 presentation: the biome-aware glitch layers and the arcade bridge look. Cosmetic only: it reads the camera scroll,
 * the run clock and a look decision (systems/BiomeTransition.js), draws behind the play layer, and touches no
 * terrain, physics, hazard or score state. Its randomness is a named cosmetic stream (CosmeticRandom), never a gameplay one.
 *
 * One screen-space Container at depth -99 (above Background at -100, below the terrain at 5), counter-scaled for camera
 * zoom like Background. Layers, bottom to top:
 *   Debutmont  an ordered-dither sky, two pixel-stepped SVG ridgelines (parallax), blocky pixel snow, an occasional
 *              scanline shimmer. Background stops drawing its own sky bands and ridges while this skin is on.
 *   Glacier    corrupt-trash debris: blocky trash pixels and colour-channel-offset glitch fragments.
 *   Arcade     the veil: Bayer-dithered pixel blocks that cover the backdrop (coverage = BiomeTransition veil), then a
 *              dithered sky, a stepped sun, a blocky skyline, a neon perspective grid and CRT scanlines.
 * Every other biome shows nothing from here.
 *
 * Hot path: no allocations (typed-array pools, whole-pixel positions, no per-frame closures). Reduced motion keeps the
 * art but stops the time-driven parts (snow fall, shimmer, debris) and the dissolve (the veil is simply on or off).
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { VEIL_CELL_PX, veilCovers, hash01 } from '../systems/BiomeTransition.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';
import { mixColor } from '../ui/MenuArt.js';
import { BACKDROP_ART, hasBackdropArt } from '../ui/BackdropArt.js';
import { visibleDanceStrength } from '../systems/WorldDance.js';

const ADD = 1; // Phaser.BlendModes.ADD
const DEPTH = -99;

const SNOW_COUNT = 64;
const DEBRIS_TRASH = 26;
const DEBRIS_FRAG = 14;
/** Debris lives in the upper part of the screen (the sky); the ground covers the rest. */
const DEBRIS_BAND_H = GAME_HEIGHT * 0.8;

/** Where the arcade horizon sits on screen (y). */
const HORIZON_Y = 118;
const ARCADE_SUN_DANCE = Object.freeze({ squashX: .42, squashY: .28, bounce: 22 });
// Roof boundaries in the existing 120-cell skyline art (4 native px/cell).
// Two tiled copies, with each building slice rooted at the same horizon.
const ARCADE_TOWER_EDGES = Object.freeze([0,6,11,16,23,28,33,39,46,51,58,64,72,79,86,90,95,105,113,116,120]);
// Hand-tuned gains and adjacent-band blends. Each roof has its own response,
// not just one of three synchronized height groups. Both wrap copies share it.
const ARCADE_TOWER_GAIN = Object.freeze([1.25,.55,1.1,.72,1.18,.48,.94,
  .62,1.25,.5,1.08,.76,1.2,.52,.98,.58,1.25,.72,1.12,.46]);
const ARCADE_TOWER_BLEND = Object.freeze([0,.32,.12,.48,.08,.4,.24,
  .38,0,.46,.15,.3,.06,.42,.18,.36,0,.28,.12,.48]);
const GRID_COLS = 9; // perspective lane lines each side of centre
const GRID_ROWS = 9;
const LANE_PX = 84; // lane spacing at the bottom of the screen

const CRT_KEY = 'bd-crt-lines';
/** How long one shimmer pass sweeps (ms). */
const SHIMMER_MS = 1100;

const wrap = (v, n) => ((v % n) + n) % n;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class BiomeFx {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object} palette the live (look) palette
   * @param {Object} arcadePalette the base palette the arcade bridge wears
   * @param {{setSkin:function(string|null):void}|null} [background] the Background to hand its sky/ridges over to
   */
  constructor(scene, palette, arcadePalette, background = null) {
    this.scene = scene;
    this.bg = background;
    this.palette = palette;
    this.arc = arcadePalette;
    this.lookId = null;
    this.veil = 0;
    this._veilDrawn = -1; // veil level the block layer was last drawn at (-1 = stale)
    this._gridKey = -1;
    this.debut = false;
    this.gdg = false;
    this.hasDebutArt = hasBackdropArt(scene, 'debutmontSky') && hasBackdropArt(scene, 'debutmontRidgeFar') && hasBackdropArt(scene, 'debutmontRidgeNear');
    this.shimNext = 0; // run-clock ms of the next shimmer pass (0 = not scheduled yet)
    this.shimStart = -1;
    this._rng = cosmeticRandom('biomefx');
    this._seed = (this._rng.next() * 0x7fffffff) | 0;

    const add = scene.add;
    this.root = add.container(0, 0).setScrollFactor(0).setDepth(DEPTH);
    const img = (name, x, y) => (hasBackdropArt(scene, name)
      ? add.image(x, y, BACKDROP_ART[name].key).setOrigin(0, 0).setScrollFactor(0) : null);
    // Pin the full texture: registering EQ slices changes Phaser's default frame.
    const tile = (name, x, y, w, h) => (hasBackdropArt(scene, name)
      ? add.tileSprite(x, y, w, h, BACKDROP_ART[name].key, '__BASE').setOrigin(0, 0).setScrollFactor(0) : null);

    // Debutmont
    this.debutSky = img('debutmontSky', 0, 8);
    this.ridgeFar = tile('debutmontRidgeFar', 0, 54, GAME_WIDTH, BACKDROP_ART.debutmontRidgeFar.h);
    this.ridgeNear = tile('debutmontRidgeNear', 0, 100, GAME_WIDTH, BACKDROP_ART.debutmontRidgeNear.h);
    this.snowG = add.graphics().setScrollFactor(0);
    // Glacier
    this.debrisG = add.graphics().setScrollFactor(0);
    this.debrisAdd = add.graphics().setScrollFactor(0).setBlendMode(ADD);
    // Arcade
    this.veilG = add.graphics().setScrollFactor(0);
    this.arcSky = img('arcadeSky', 0, HORIZON_Y - BACKDROP_ART.arcadeSky.h);
    this.arcSun = img('arcadeSun', 300, HORIZON_Y - BACKDROP_ART.arcadeSun.h);
    this.arcSkyline = tile('arcadeSkyline', 0, HORIZON_Y - BACKDROP_ART.arcadeSkyline.h, GAME_WIDTH, BACKDROP_ART.arcadeSkyline.h);
    this.arcTowers = this._buildArcadeTowers();
    this.gridG = add.graphics().setScrollFactor(0);
    this.crt = this._crtImage();
    const kids = [this.debutSky, this.ridgeFar, this.ridgeNear, this.snowG, this.debrisG, this.debrisAdd, this.veilG,
      this.arcSky, this.arcSun, this.arcSkyline, ...this.arcTowers, this.gridG, this.crt];
    this.root.add(kids.filter(Boolean));
    this.root.setVisible(false);

    this._buildPools();
    this.setPalettes(palette, arcadePalette);
    this._applyVisibility(0);
  }

  // Split the existing texture rather than introducing replacement buildings.
  // Frames are shared across runs; sprites are allocated only at scene setup.
  _buildArcadeTowers() {
    if (!this.arcSkyline) return [];
    const a = BACKDROP_ART.arcadeSkyline;
    const texture = this.scene.textures?.get(a.key);
    if (!texture?.add || !texture?.has) return [];
    const towers = [];
    for (let i=0;i<ARCADE_TOWER_EDGES.length-1;i++) {
      const x=ARCADE_TOWER_EDGES[i]*4, w=ARCADE_TOWER_EDGES[i+1]*4-x;
      const frame='arcade-eq-'+i;
      if (!texture.has(frame)) texture.add(frame,0,x,0,w,a.h);
      for(let copy=0;copy<2;copy++){
        const sprite=this.scene.add.image(x+copy*a.w,HORIZON_Y,a.key,frame)
          .setOrigin(0,1).setScrollFactor(0).setVisible(false);
        towers.push(sprite);
      }
    }
    return towers;
  }

  // ------------------------------------------------------------------ setup

  /** One 480x270 canvas of 1 px dark rows every third row: the CRT scanlines. Shared across runs. */
  _crtImage() {
    const tm = this.scene.textures;
    if (!tm) return null;
    if (!tm.exists(CRT_KEY)) {
      const tex = tm.createCanvas(CRT_KEY, GAME_WIDTH, GAME_HEIGHT);
      const ctx = tex && tex.context;
      if (!ctx) return null;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      for (let y = 1; y < GAME_HEIGHT; y += 3) ctx.fillRect(0, y, GAME_WIDTH, 1);
      tex.refresh();
    }
    return this.scene.add.image(0, 0, CRT_KEY).setOrigin(0, 0).setScrollFactor(0);
  }

  /** Fixed-size typed pools, laid out once from the cosmetic stream; nothing is allocated per frame. */
  _buildPools() {
    const r = this._rng;
    const n = SNOW_COUNT;
    this.snowX = new Float32Array(n);
    this.snowY = new Float32Array(n);
    this.snowS = new Uint8Array(n);
    this.snowV = new Float32Array(n);
    this.snowZ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const roll = r.next();
      const s = roll < 0.5 ? 2 : roll < 0.8 ? 3 : 4;
      this.snowX[i] = r.next() * GAME_WIDTH;
      this.snowY[i] = r.next() * GAME_HEIGHT;
      this.snowS[i] = s;
      this.snowV[i] = 12 + s * 9 + r.next() * 8; // px/s: bigger flakes are nearer, so faster
      this.snowZ[i] = 0.03 + s * 0.035; // parallax: nearer = more camera-driven drift
    }
    const m = DEBRIS_TRASH + DEBRIS_FRAG;
    this.dX = new Float32Array(m);
    this.dY = new Float32Array(m);
    this.dW = new Uint8Array(m);
    this.dH = new Uint8Array(m);
    this.dVx = new Float32Array(m);
    this.dVy = new Float32Array(m);
    this.dZ = new Float32Array(m);
    this.dK = new Uint8Array(m); // 0..2 trash colour, 3 fragment
    this.dPh = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const frag = i >= DEBRIS_TRASH;
      this.dX[i] = r.next() * GAME_WIDTH;
      this.dY[i] = r.next() * DEBRIS_BAND_H;
      this.dW[i] = frag ? 8 + ((r.next() * 5) | 0) * 2 : 2 + ((r.next() * 3) | 0) * 2;
      this.dH[i] = frag ? 2 + ((r.next() * 2) | 0) * 2 : this.dW[i] > 4 ? 2 : this.dW[i];
      this.dVx[i] = -(4 + r.next() * 10);
      this.dVy[i] = 5 + r.next() * 9;
      this.dZ[i] = 0.05 + r.next() * 0.2;
      this.dK[i] = frag ? 3 : (r.next() * 3) | 0;
      this.dPh[i] = r.next() * 50;
    }
  }

  /**
   * Re-tint everything from the live palettes (a palette setting change, or the look changing biome).
   * @param {Object<string,number>} palette the look palette (the biome the world currently wears)
   * @param {Object<string,number>} arcadePalette the base palette (arcade bridges)
   * @returns {void}
   */
  setPalettes(palette, arcadePalette) {
    this.palette = palette;
    this.arc = arcadePalette;
    const p = palette;
    const a = arcadePalette;
    if (this.debutSky) this.debutSky.setTint(p.magenta).setAlpha(0.38);
    if (this.ridgeFar) this.ridgeFar.setTint(p.magenta).setAlpha(0.8);
    if (this.ridgeNear) this.ridgeNear.setTint(p.cyan).setAlpha(0.9);
    if (this.arcSky) this.arcSky.setTint(a.magenta).setAlpha(0);
    if (this.arcSun) this.arcSun.setTint(a.magenta).setAlpha(0);
    if (this.arcSkyline) this.arcSkyline.setTint(a.cyan).setAlpha(0);
    for(const tower of this.arcTowers||[]) tower.setTint(a.cyan).setAlpha(0);
    // deep blue / near black checker for the veil blocks, derived from the palette so colour-blind mode applies
    this.veilA = a.bg;
    this.veilB = mixColor(a.bgAlt, a.cyan, 0.1);
    this._veilDrawn = -1; // the blocks and the grid are palette-coloured: redraw
    this._gridKey = -1;
  }

  /**
   * Which biome's look the world wears now. Switches the biome sets on or off and hands Background's sky/ridges to the
   * SVG layers for Debutmont.
   * @param {string|null} lookId
   * @returns {void}
   */
  setLook(lookId) {
    this.lookId = lookId;
    const debut = lookId === 'debutmont' && this.hasDebutArt;
    const gdg = lookId === 'garbage-dump-glacier';
    // leaving a set drops what it last drew, so nothing stale shows if the set comes back later
    if (this.debut && !debut) { this.snowG.clear(); this.shimStart = -1; this.shimNext = 0; }
    if (this.gdg && !gdg) { this.debrisG.clear(); this.debrisAdd.clear(); }
    this.debut = debut;
    this.gdg = gdg;
    if (this.bg && typeof this.bg.setSkin === 'function') this.bg.setSkin(this.debut ? 'pixel' : null);
  }

  /** Counter-scale for camera zoom (screen-space layer), the same transform Background gets. */
  applyZoomCompensation(k, px, py) {
    if (this.root) this.root.setScale(k).setPosition(px, py);
  }

  _applyVisibility(veil) {
    const arc = veil > 0;
    if (!arc) { this._veilDrawn = -1; this._gridKey = -1; } // hidden: the next showing redraws
    const sky = this.debut && veil < 1;
    if (this.debutSky) this.debutSky.setVisible(sky);
    if (this.ridgeFar) this.ridgeFar.setVisible(sky);
    if (this.ridgeNear) this.ridgeNear.setVisible(sky);
    this.snowG.setVisible(sky);
    this.debrisG.setVisible(this.gdg && veil < 1);
    this.debrisAdd.setVisible(this.gdg && veil < 1);
    this.veilG.setVisible(arc);
    this.gridG.setVisible(arc && veil >= 0.5);
    if (this.arcSky) this.arcSky.setVisible(arc);
    if (this.arcSun) this.arcSun.setVisible(arc);
    if (this.arcSkyline) this.arcSkyline.setVisible(arc);
    if(!arc&&this._arcTowersActive){
      for(const tower of this.arcTowers||[])tower.setVisible(false).setScale(1,1);
      this._arcTowersActive=false;
    }
    if (this.crt) this.crt.setVisible(arc);
    this.root.setVisible(this.debut || this.gdg || arc);
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param {number} scrollX camera scroll x (world px)
   * @param {number} timeMs the run clock
   * @param {number} veil 0..1 bridge veil coverage (BiomeTransition.bridgeLook)
   * @param {boolean} reduced reduced motion: art stays, time-driven motion stops
   * @returns {void}
   */
  update(scrollX, timeMs, veil, reduced, skylineBands = null) {
    this.veil = veil;
    this._applyVisibility(veil);
    if (!this.root.visible) return;
    const t = reduced ? 0 : timeMs;
    const dance = reduced ? 0 : visibleDanceStrength(this.bg?.danceStrength);
    if (this.debut && veil < 1) this._drawDebutmont(scrollX, t, timeMs, reduced, dance);
    if (this.gdg && veil < 1 && !reduced) this._drawDebris(scrollX, t, dance);
    else if (this.gdg) { this.debrisG.clear(); this.debrisAdd.clear(); }
    if (veil > 0) this._drawArcade(scrollX, veil, dance, reduced ? null : skylineBands);
  }

  // ------------------------------------------------------------------ Debutmont

  _drawDebutmont(scrollX, t, runMs, reduced, dance = 0) {
    const p = this.palette;
    if (this.ridgeFar) {
      const lift=Math.round(22*dance);
      this.ridgeFar.tilePositionX=Math.round(scrollX*.1-12*dance);
      this.ridgeFar.y=54-lift;
      this.ridgeFar.scaleY=1+lift/BACKDROP_ART.debutmontRidgeFar.h;
    }
    if (this.ridgeNear) {
      const lift=Math.round(36*dance);
      this.ridgeNear.tilePositionX=Math.round(scrollX*.22+20*dance);
      this.ridgeNear.y=100-lift;
      this.ridgeNear.scaleY=1+lift/BACKDROP_ART.debutmontRidgeNear.h;
    }
    // ---- blocky pixel snow: whole-pixel squares, a slight stepped horizontal jitter, no round flakes
    const g = this.snowG;
    g.clear();
    const jstep = Math.floor(t / 220);
    for (let i = 0; i < SNOW_COUNT; i++) {
      const s = this.snowS[i];
      const jit = reduced ? 0 : Math.floor(hash01(jstep + i * 131, this._seed) * 3) - 1;
      const x = ((wrap(this.snowX[i] - scrollX * this.snowZ[i] - t * 0.0045 * s + jit + dance * (i % 2 ? 24 : -24), GAME_WIDTH)) >> 1) << 1;
      const y = ((wrap(this.snowY[i] + (t * this.snowV[i]) / 1000 - dance * (12 + 3*s), GAME_HEIGHT)) >> 1) << 1;
      g.fillStyle(i % 6 === 0 ? p.cyan : p.text, s === 4 ? 0.85 : s === 3 ? 0.7 : 0.55);
      g.fillRect(x, y, s, s);
    }
    // ---- an occasional scanline shimmer: a short band of 1 px rows sweeping down the sky, faint, never the whole screen
    if (reduced) return;
    if (runMs < this.shimStart) { this.shimNext = 0; this.shimStart = -1; } // the run clock restarted
    if (this.shimNext === 0) this.shimNext = runMs + this._rng.range(5000, 11000);
    if (this.shimStart < 0 && runMs >= this.shimNext) this.shimStart = runMs;
    if (this.shimStart >= 0) {
      const k = (runMs - this.shimStart) / SHIMMER_MS;
      if (k >= 1) {
        this.shimStart = -1;
        this.shimNext = runMs + this._rng.range(7000, 15000);
      } else {
        const y0 = (Math.floor(k * 120) >> 1) << 1;
        g.fillStyle(p.text, 0.09);
        for (let y = y0; y < y0 + 14; y += 2) g.fillRect(0, y, GAME_WIDTH, 1);
        g.fillStyle(p.cyan, 0.06);
        for (let y = y0 + 15; y < y0 + 21; y += 2) g.fillRect(0, y, GAME_WIDTH, 1);
      }
    }
  }

  // ------------------------------------------------------------------ Garbage Dump Glacier

  _drawDebris(scrollX, t, dance = 0) {
    const p = this.palette;
    const g = this.debrisG;
    const ga = this.debrisAdd;
    g.clear();
    ga.clear();
    const jstep = Math.floor(t / 650);
    for (let i = 0; i < DEBRIS_TRASH + DEBRIS_FRAG; i++) {
      const k = this.dK[i];
      let x = wrap(this.dX[i] + (t * this.dVx[i]) / 1000 - scrollX * this.dZ[i], GAME_WIDTH);
      const y = ((wrap(this.dY[i] + (t * this.dVy[i]) / 1000 - dance * (i % 2 ? 32 : 20), DEBRIS_BAND_H)) >> 1) << 1;
      if (k < 3) {
        // blocky trash: 2-6 px rectangles in the glacier's greens, low alpha, behind the play layer
        g.fillStyle(k === 0 ? p.lime : k === 1 ? p.amber : p.text, 0.62);
        g.fillRect((x >> 1) << 1, y, this.dW[i], this.dH[i]);
      } else {
        // a glitched fragment: the same block three times with the colour channels pulled apart; it hops sideways
        // and drops out on a slow stepped schedule, like a corrupt sprite
        const step = Math.floor(jstep + this.dPh[i]);
        const h = hash01(step + i * 17, this._seed);
        if (h < 0.28) continue; // dropped frame
        x += h > 0.8 ? 6 : h > 0.65 ? -4 : 0;
        const xi = (x >> 1) << 1;
        const w = this.dW[i];
        const hh = this.dH[i];
        ga.fillStyle(this.arc.magenta, 0.4);
        ga.fillRect(xi - 3, y, w, hh);
        ga.fillStyle(this.arc.cyan, 0.4);
        ga.fillRect(xi + 3, y, w, hh);
        ga.fillStyle(p.text, 0.3);
        ga.fillRect(xi, y, w, hh);
      }
    }
  }

  // ------------------------------------------------------------------ arcade bridge

  /** Redraw the veil blocks and their neon block grid at this coverage. */
  _drawVeilBlocks(veil) {
    const g = this.veilG;
    const a = this.arc;
    g.clear();
    // ---- the pixel-block veil: Bayer-dithered coverage of 16 px blocks in two deep-blue shades, so the biome look
    // dissolves into chunky pixels, and the same blocks hold the backdrop once the dissolve is complete
    const cols = GAME_WIDTH / VEIL_CELL_PX;
    const rows = Math.ceil(GAME_HEIGHT / VEIL_CELL_PX);
    if (veil >= 1) {
      g.fillStyle(this.veilA, 1);
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      g.fillStyle(this.veilB, 1);
      for (let iy = 0; iy < rows; iy++) for (let ix = (iy & 1); ix < cols; ix += 2) g.fillRect(ix * VEIL_CELL_PX, iy * VEIL_CELL_PX, VEIL_CELL_PX, VEIL_CELL_PX);
    } else {
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle(pass ? this.veilB : this.veilA, 1);
        for (let iy = 0; iy < rows; iy++) {
          for (let ix = 0; ix < cols; ix++) {
            if (((ix + iy) & 1) !== pass || !veilCovers(ix, iy, veil)) continue;
            g.fillRect(ix * VEIL_CELL_PX, iy * VEIL_CELL_PX, VEIL_CELL_PX, VEIL_CELL_PX);
          }
        }
      }
    }
    // wireframe: the block grid as neon hairlines, brighter as coverage rises
    g.lineStyle(1, a.cyan, 0.1 + 0.2 * veil);
    for (let x = 0; x <= GAME_WIDTH; x += VEIL_CELL_PX) g.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y <= GAME_HEIGHT; y += VEIL_CELL_PX) g.lineBetween(0, y, GAME_WIDTH, y);
  }

  _drawArcadeSkyline(scrollX, alpha, bands) {
    if(!this.arcSkyline)return;
    const offset=Math.round(scrollX*.05);
    const towers=this.arcTowers||[];
    const active=towers.length>0&&alpha>0&&bands&&
      (bands[0]>0.005||bands[1]>0.005||bands[2]>0.005);
    this.arcSkyline.setAlpha(alpha).setVisible(!active);
    this.arcSkyline.tilePositionX=offset;
    // No per-building updates outside the active EQ. Keep off-screen copies
    // hidden, so only one screen of towers participates in rendering.
    if(!active&&!this._arcTowersActive)return;
    this._arcTowersActive=!!active;
    const shift=wrap(offset,BACKDROP_ART.arcadeSkyline.w);
    for(let i=0;i<towers.length;i+=2){
      const j=i/2, band=Math.min(2,Math.floor(j*3/(towers.length/2)));
      const x=ARCADE_TOWER_EDGES[j]*4-shift;
      const blend=ARCADE_TOWER_BLEND[j];
      const neighbor=band===0?1:band===2?1:j%2===0?0:2;
      // Treble is normally quieter in a full mix; give it a little more
      // visual sensitivity, without exceeding the original maximum height.
      const primary=active?clamp01((bands[band]||0)*(band===2?1.6:1)):0;
      const secondary=active?clamp01((bands[neighbor]||0)*(neighbor===2?1.6:1)):0;
      const level=primary*(1-blend)+secondary*blend;
      const sy=1+ARCADE_TOWER_GAIN[j]*level;
      for(let copy=0;copy<2;copy++){
        const tower=towers[i+copy];
        const left=x+copy*BACKDROP_ART.arcadeSkyline.w;
        const w=(ARCADE_TOWER_EDGES[j+1]-ARCADE_TOWER_EDGES[j])*4;
        const visible=!!active&&left+w>0&&left<GAME_WIDTH;
        tower.setVisible(visible);
        if(active){
          tower.x=left;
          tower.setScale(1,sy).setAlpha(alpha);
        }else tower.setScale(1,1);
      }
    }
  }

  _drawArcade(scrollX, veil, dance = 0, skylineBands = null) {
    const a = this.arc;
    // The block layer depends only on the veil level (and the palette), so it is drawn when the level changes and
    // left alone otherwise: the whole pure-arcade stretch of a bridge costs no redraw.
    if (veil !== this._veilDrawn) {
      this._veilDrawn = veil;
      this._drawVeilBlocks(veil);
    }

    // ---- the arcade scene fades in over the last stretch of the dissolve (under near-full coverage, so no pop)
    const a1 = clamp01((veil - 0.6) / 0.4);
    if (this.arcSky) this.arcSky.setAlpha(0.45 * a1);
    if (this.arcSun) {
      this.arcSun.setAlpha(0.95 * a1);
      // Preserve the original centre with the artwork's top-left origin.
      // A squash-and-hop rather than just resizing. Keep the horizontal
      // centre fixed and let the veil continue to own opacity.
      const sx=1+ARCADE_SUN_DANCE.squashX*dance;
      const sy=1-ARCADE_SUN_DANCE.squashY*dance;
      this.arcSun.setScale(sx,sy);
      this.arcSun.x=300-BACKDROP_ART.arcadeSun.w*(sx-1)/2;
      this.arcSun.y=HORIZON_Y-BACKDROP_ART.arcadeSun.h-BACKDROP_ART.arcadeSun.h*(sy-1)/2-ARCADE_SUN_DANCE.bounce*dance;
    }
    this._drawArcadeSkyline(scrollX,0.55*a1,skylineBands);
    if (this.crt) this.crt.setAlpha(veil);
    const gg = this.gridG;
    if (veil < 0.5) { if (this._gridKey !== 0) { gg.clear(); this._gridKey = 0; } return; }
    // the grid is a function of the camera and the fade only: unchanged inputs keep last frame's drawing
    const key = Math.round(scrollX) * 1000 + Math.round(a1 * 100) + 1;
    if (key === this._gridKey) return;
    this._gridKey = key;
    gg.clear();
    // perspective grid under the horizon: lanes converge on the vanishing point and slide with the camera; rows
    // advance toward the viewer. Both are pure functions of scrollX.
    const vx = GAME_WIDTH / 2;
    const slide = (scrollX * 0.6) % LANE_PX;
    gg.lineStyle(1, a.magenta, 0.55 * a1);
    for (let i = -GRID_COLS; i <= GRID_COLS; i++) {
      const bx = vx + i * LANE_PX - slide;
      gg.lineBetween(vx + (bx - vx) * 0.04, HORIZON_Y, bx, GAME_HEIGHT);
    }
    const adv = wrap(scrollX * 0.004, 1);
    gg.lineStyle(1, a.cyan, 0.6 * a1);
    for (let j = 0; j < GRID_ROWS; j++) {
      const u = (j + adv) / GRID_ROWS;
      const y = Math.round(HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * u * u);
      gg.lineBetween(0, y, GAME_WIDTH, y);
    }
    // the horizon itself: a bright 2 px line with a magenta glow row beneath it
    gg.fillStyle(a.cyan, a1);
    gg.fillRect(0, HORIZON_Y, GAME_WIDTH, 2);
    gg.fillStyle(a.magenta, 0.5 * a1);
    gg.fillRect(0, HORIZON_Y + 2, GAME_WIDTH, 2);
  }

  /** @returns {void} */
  destroy() {
    if (this.root) this.root.destroy(true);
    this.root = null;
    if (this.bg && typeof this.bg.setSkin === 'function') this.bg.setSkin(null);
    this.bg = null;
  }
}
