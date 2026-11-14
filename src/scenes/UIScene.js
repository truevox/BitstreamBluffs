/**
 * OWNER: UI engineer.
 * HUD overlay launched in parallel by RunScene (`scene.launch(SCENES.UI)`) and stopped by RunScene on shutdown.
 * Read-only: it only LISTENS to game.events (SCORE_CHANGED, COMBO_CHANGED, DISTANCE_CHANGED, TRICK, LANDING,
 * POWERUP_*, HAZARD_HIT / EFFECT_END, ZONE_*, GLITCH_*, CRASH, RESPAWN, GAME_PAUSE / RESUME, RUN_START) and never reaches
 * into RunScene. It may miss RUN_START (it is launched in the same frame RunScene emits it), so everything is
 * initialised from the registry / DailyPatch as well.
 *
 * Speed has no contract event: it is derived from DISTANCE_CHANGED over time. RunScene MAY additionally emit the
 * optional event HUD_SPEED_EVENT with {speedPxS} (about 10 Hz) for an exact reading (see ARCHITECTURE.md UI addenda).
 *
 * Layout (480x270): score top-left, combo top-right, zone chip + warnings top-centre, trick popups below them, power-up
 * timers bottom-left, seed / daily rule bottom-right. The middle band where the rider lives stays clear.
 * Centre banners (warnings, BOOST, PERFECT LANDING, sector strip, bank line, crash banner, popups) never share a slot:
 * `_layout()` stacks the visible ones top to bottom (ui/HudLayout.js `stackY`) from their classic y, pushing them under the fixed
 * HUD rows, the zone chip and the touch buttons they would touch. The sector / mission strip is a full-width band and takes its
 * slot in that same stack (a `full` item), so it cannot overlap the banners above or below it. The bottom row (power-ups, tutorial chip) does the same with `placeX`.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT, PIXELS_PER_METER, SCORING } from '../constants.js';
import { EVT } from '../events.js';
import { missionToastText, stripToastText } from '../ui/MissionsUi.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { Theme } from '../ui/Theme.js';
import { NeonText, strokeRectPx } from '../ui/Neon.js';
import { measureText } from '../ui/PixelFont.js';
import { addScanlines } from '../ui/Scanlines.js';
import { fmtInt, fmtMult, fmtSec, idToLabel } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';
import { stackY, placeX, STRIP_BAND } from '../ui/HudLayout.js';

/** Optional extra event (additive): payload {speedPxS:number}. */
export const HUD_SPEED_EVENT = 'bb:hudSpeed';

const TRICK_NAMES = {
  backflip: 'BACKFLIP', frontflip: 'FRONTFLIP', helicopterCCW: 'HELI CCW', helicopterCW: 'HELI CW',
  airBrake: 'AIR BRAKE', parachute: 'PARACHUTE',
};
const ZONE_INFO = {
  highBandwidth: { name: 'HIGH BANDWIDTH', sub: 'LOW FRICTION', color: 'cyan' },
  compression: { name: 'COMPRESSION', sub: 'HIGH GRAVITY', color: 'magenta' },
  wirelessBridge: { name: 'WIRELESS BRIDGE', sub: 'BOUNCE PADS', color: 'lime' },
};
const POWERUP_INFO = {
  clockPulse: { name: 'CLOCK PULSE', color: 'cyan' },
  packetBurst: { name: 'PACKET BURST', color: 'lime' },
  hashedBackup: { name: 'HASHED BACKUP', color: 'amber' },
};
/**
 * Power-up KINDS (B0, biome full treatment). Biome pickups are keyed by id like the base ones once their content lands;
 * until a pickup id has its own POWERUP_INFO row, its chip, popup colour and icon come from its effect kind here.
 */
const POWERUP_KIND_INFO = {
  ward: { color: 'cyan' },
  glide: { color: 'lime' },
  stabilize: { color: 'amber' },
};
/** Hazard effects on screen. `showMs`: minimum time the warning stays up (a gust is instant, so it reports 0 ms). */
const EFFECT_INFO = {
  scramble: { label: 'PHYSICS SCRAMBLE', color: 'danger' },
  slow: { label: 'SPEED CUT', color: 'amber' },
  blind: { label: 'BLINDED', color: 'amber' },
  gust: { label: 'GUST', color: 'cyan', showMs: 700 },
};

const HINT_TEXT = {
  keyboard: { push: 'W  PUSH', hop: 'SPACE  HOP', flip: 'IN AIR  HOLD A / D  FLIP', tuck: 'A+D  TUCK', boost: 'CLEAN LANDING = SPEED BOOST' },
  touch: { push: 'TAP PUSH', hop: 'TAP HOP', flip: 'IN AIR  HOLD TILT  FLIP', tuck: 'HOLD TUCK', boost: 'CLEAN LANDING = SPEED BOOST' },
  gamepad: { push: 'RT  PUSH', hop: 'A  HOP', flip: 'IN AIR  HOLD STICK L / R  FLIP', tuck: 'LT  TUCK', boost: 'CLEAN LANDING = SPEED BOOST' },
};
const CHAIN_LIFE_MS = 2500;
/** Backstop only: RunScene's HintScheduler (systems/HintScheduler.js) owns hint timing and always sends the hide. */
const HINT_MAX_MS = 8000;

/** Flow meter: compact readout under the pending-points line (top-right), bar width in px. */
const FLOW_Y = 62;
const FLOW_BAR_W = 64;
/** Widest a popup line may be (screen is 480 px). */
const POPUP_MAX_W = 440;
const flowColor = (f) => (f >= 2.5 ? 'magenta' : f >= 2 ? 'amber' : f >= 1.5 ? 'lime' : 'cyan');
/** 1.5 -> '1.5', 1.25 -> '1.25', 2 -> '2'. */
const fmtShort = (n) => String(Math.round(n * 100) / 100);

/** The named-combo bank line (the payoff) is its own big line; the small popups stack under it. */
const BANK_Y = 80;
const POPUP_Y = 100;
const POPUP_STEP = 11;
const MAX_POPUPS = 3;
/** Row of the shard counter (the speed row above it is 10 px high; its pop stays under that). */
const SHARD_Y = 53;
/** Classic top y of each centre slot (used when nothing above it is showing). */
const SLOT = { warn: 22, boost: 24, flash: 46, strip: 59, bank: BANK_Y, banner: 86, popup: POPUP_Y };
/**
 * Strip slide timings. `runEnd` must finish well inside RunScene's 950 ms crash-to-Game-Over stop (RUN_END is
 * emitted at the crash, and the stop is checked once per frame), so it ends at 800 ms.
 */
const STRIP_TIMING = {
  normal: { inMs: 220, holdMs: 500, outMs: 220 },
  runEnd: { inMs: 200, holdMs: 400, outMs: 200 },
};
const POWER_Y = GAME_HEIGHT - 28;
const POWER_PITCH = 62;
const HINT_ROWS = [GAME_HEIGHT - 23, GAME_HEIGHT - 44];

export class UIScene extends Phaser.Scene {
  constructor() {
    super(SCENES.UI);
  }

  create() {
    this.frozen = false;
    this.listeners = [];
    const theme = (this.theme = new Theme(this));
    const content = this.registry.get(REG.CONTENT) || {};
    this.content = content;
    this.hud = this.add.container(0, 0);

    // state
    this.score = 0;
    this.meters = 0;
    this.multiplier = 1;
    this.speedMs = 0;
    this.lastDist = { m: 0, t: 0 };
    this.exactSpeedUntil = 0;
    this.powerups = new Map();
    this.effects = new Map();
    this.zones = [];
    this.popups = [];
    this.glitchUntil = 0;
    this.nowMs = 0;
    this.runId = '';
    this.dailyRuleId = '';
    this.shards = 0;
    this.chain = 0;
    this.chainUntil = 0;
    this.pending = 0;
    this.pendingRaw = 0;
    this.hintId = null;
    this.hintUntil = 0;
    this.stripQueue = [];
    this.stripBusy = false;
    this.missionToastsThisRun = new Set();
    this.bestShown = false;
    this.flow = 1;
    this.flowFrac = 0;
    this.flowStep = 0;
    this.zoneY = 3;
    this.powerX = 8;
    this.hintX = 0;
    this.hintY = HINT_ROWS[0];
    this.touchRects = [];
    this.touchAt = -1e9;
    this.bannerScale = 3;
    this.boostScale = 2;

    this._buildStats();
    this._buildCenter();
    this._buildFooter();
    this._buildSeedInfo(this.registry.get(REG.SEED));
    this.scan = addScanlines(this, 0.55);

    const on = (evt, fn) => {
      this.game.events.on(evt, fn, this);
      this.listeners.push([evt, fn]);
    };
    on(EVT.RUN_START, this.onRunStart);
    on(EVT.SCORE_CHANGED, this.onScore);
    on(EVT.COMBO_CHANGED, this.onCombo);
    on(EVT.DISTANCE_CHANGED, this.onDistance);
    on(HUD_SPEED_EVENT, this.onSpeed);
    on(EVT.TRICK, this.onTrick);
    on(EVT.LANDING, this.onLanding);
    on(EVT.POWERUP_COLLECTED, this.onPowerCollected);
    on(EVT.POWERUP_EXPIRED, this.onPowerExpired);
    on(EVT.HAZARD_HIT, this.onHazard);
    on(EVT.EFFECT_END, this.onEffectEnd);
    on(EVT.ZONE_ENTER, this.onZoneEnter);
    on(EVT.ZONE_EXIT, this.onZoneExit);
    on(EVT.GLITCH_START, this.onGlitchStart);
    on(EVT.GLITCH_END, this.onGlitchEnd);
    on(EVT.CRASH, this.onCrash);
    on(EVT.RESPAWN, this.onRespawn);
    on(EVT.GAME_PAUSE, this.onPause);
    on(EVT.GAME_RESUME, this.onResume);
    on(EVT.RUN_END, this.onRunEnd);
    on(EVT.LANDING_BOOST, this.onBoost);
    on(EVT.NEAR_MISS, this.onNearMiss);
    on(EVT.SHARD_COLLECTED, this.onShard);
    on(EVT.MILESTONE, this.onMilestone);
    on(EVT.NEW_BEST, this.onNewBest);
    // W3: biome banner. Uses the same serialised strip queue as milestones and missions, so two strips
    // never show at once. Overlap with the FLOW indicator, the trick popups and the other centre banners
    // is prevented by _layout, which stacks the strip band with them as one full-width slot.
    on(EVT.BIOME_ENTER, this.onBiomeEnter);
    on(EVT.TUTORIAL_HINT, this.onHint);
    on(EVT.FLOW_CHANGED, this.onFlowChanged);
    on(EVT.FLOW_LOST, this.onFlowLost);
    // W2: toast the moment a mission is met, not just at run end.
    on(EVT.MISSION_COMPLETED, this.onMissionCompleted);

    const cleanup = () => {
      for (const [evt, fn] of this.listeners) this.game.events.off(evt, fn, this);
      this.listeners.length = 0;
    };
    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
  }

  // ---------------------------------------------------------------- build

  _t(x, y, text, opts) {
    const t = new NeonText(this, this.theme, x, y, text, opts);
    this.hud.add(t);
    return t;
  }

  _buildStats() {
    this.scoreLabel = this._t(8, 4, 'SCORE', { color: 'cyan' });
    this.scoreLabel.setAlpha(0.8);
    this.scoreText = this._t(8, 13, '0', { color: 'text', scale: 2 });
    this.distText = this._t(8, 31, '0 M', { color: 'lime' });
    this.speedText = this._t(8, 41, '0 KM/H', { color: 'cyan' });
    this.comboLabel = this._t(GAME_WIDTH - 8, 4, 'COMBO', { color: 'magenta', anchor: 'right' });
    this.comboLabel.setAlpha(0.8);
    this.comboText = this._t(GAME_WIDTH - 8, 13, 'x1.00', { color: 'lime', scale: 2, anchor: 'right' });
    this.comboInfo = this._t(GAME_WIDTH - 8, 31, '', { color: 'amber', anchor: 'right' });
    // pending (at stake) trick points, pulses while the multiplier is above x1
    this.pendingText = this._t(GAME_WIDTH - 8, 43, '', { color: 'amber', scale: 2, anchor: 'right', outline: 'glow' });
    this.shardText = this._t(8, SHARD_Y, '', { color: 'cyan' });
    this.chainText = this._t(8, SHARD_Y, '', { color: 'amber' });
    this.shardLabel = '';
    this.shardText.setVisible(false);
    this.chainText.setVisible(false);
    // flow streak: label + draining timeout bar, only visible while flow > 1
    this.flowText = this._t(GAME_WIDTH - 8, FLOW_Y, 'FLOW x1.1', { color: 'cyan', anchor: 'right', outline: 'glow' });
    this.flowG = new Phaser.GameObjects.Graphics(this);
    this.hud.add(this.flowG);
    this.flowLostText = this._t(GAME_WIDTH - 8, FLOW_Y, 'FLOW LOST', { color: 'danger', anchor: 'right', outline: 'glow' });
    this.flowText.setVisible(false);
    this.flowG.setVisible(false);
    this.flowLostText.setAlpha(0);
  }

  _buildCenter() {
    const cx = GAME_WIDTH / 2;
    // zone chip (graphics repainted on palette change)
    this.zoneG = new Phaser.GameObjects.Graphics(this);
    this.hud.add(this.zoneG);
    this.zoneText = this._t(cx, 6, '', { color: 'cyan', anchor: 'center', outline: 'none' });
    this.zoneChip = { w: 0, key: 'cyan' };
    this.theme.bind(() => this._paintZone());
    this.zoneG.setVisible(false);
    this.zoneText.setVisible(false);
    this.warnY = 22;
    this.flash = this._t(cx, 46, '', { color: 'amber', scale: 2, anchor: 'center', vAnchor: 0.5, outline: 'glow' });
    this.flash.setAlpha(0);
    this.banner = this._t(cx, 100, '', { color: 'danger', scale: 3, anchor: 'center', vAnchor: 0.5 });
    this.banner.setAlpha(0);
    this.boostText = this._t(cx, 24, '', { color: 'lime', scale: 2, anchor: 'center', vAnchor: 0.5, outline: 'glow' });
    this.boostText.setAlpha(0);
    // payoff line of a landing: "DOUBLE BACKFLIP + HELI x1.5 +450" (big, glowing, fades after ~1.1 s)
    this.bankLine = this._t(cx, BANK_Y, '', { color: 'amber', scale: 2, anchor: 'center', vAnchor: 0.5, outline: 'glow' });
    this.bankLine.setAlpha(0);
    // slide-in strip (milestones / new best) just above the rider band
    this.stripC = this.add.container(0, 0);
    this.hud.add(this.stripC);
    this.stripG = new Phaser.GameObjects.Graphics(this);
    this.stripT = new NeonText(this, this.theme, cx, 61, '', { color: 'cyan', scale: STRIP_BAND.textScale, anchor: 'center', outline: 'glow' });
    this.stripC.add([this.stripG, this.stripT]);
    this.stripC.setVisible(false);
    this.hud.sendToBack(this.stripC); // the band sits behind the HUD rows it crosses (score / shards / flow stay readable)
    this.theme.bind(() => this._paintStrip());
    // tutorial chip
    this.hintG = new Phaser.GameObjects.Graphics(this);
    this.hintT = new NeonText(this, this.theme, cx, GAME_HEIGHT - 19, '', { color: 'text', anchor: 'center', outline: 'none' });
    this.hud.add([this.hintG, this.hintT]);
    this.hintChip = { w: 0, key: 'cyan' };
    this.theme.bind(() => this._paintHint());
    this.hintG.setVisible(false);
    this.hintT.setVisible(false);
  }

  _buildFooter() {
    this.powerG = new Phaser.GameObjects.Graphics(this);
    this.hud.add(this.powerG);
    this.theme.bind(() => this._paintPowerups());
  }

  _buildSeedInfo(seed) {
    if (this.seedText) {
      this.seedText.destroy();
      this.ruleText.destroy();
    }
    const info = DailyPatch.getDailyInfo();
    this.dailyRuleId = this.dailyRuleId || (info.rule && info.rule.id) || '';
    const isDailySeed = String(seed || '') === info.seed;
    this.seedText = this._t(GAME_WIDTH - 8, GAME_HEIGHT - 20, `SEED ${String(seed || '-').toUpperCase()}`, {
      color: 'text', anchor: 'right', outline: 'dark',
    });
    this.seedText.setAlpha(0.7);
    const rule = DailyPatch.getRuleById(this.dailyRuleId);
    const name = rule ? rule.name.toUpperCase() : idToLabel(this.dailyRuleId);
    this.ruleText = this._t(GAME_WIDTH - 8, GAME_HEIGHT - 10, this.dailyRuleId ? `${isDailySeed ? 'DAILY RUN  ' : 'DAILY RULE  '}${name}` : '', {
      color: 'amber', anchor: 'right', outline: 'dark',
    });
    this.ruleText.setAlpha(0.85);
  }

  // ---------------------------------------------------------------- painters

  _paintZone() {
    const g = this.zoneG;
    g.clear();
    if (!this.zoneChip.w) return;
    const pal = this.theme.pal;
    const c = pal[this.zoneChip.key];
    const w = this.zoneChip.w;
    const x = Math.round(GAME_WIDTH / 2 - w / 2);
    g.fillStyle(pal.bg, 0.72);
    const y = this.zoneY;
    g.fillRect(x, y, w, 13);
    strokeRectPx(g, x, y, w, 13, c, 0.9);
    g.fillStyle(c, 1);
    g.fillRect(x - 3, y, 2, 13);
    g.fillRect(x + w + 1, y, 2, 13);
  }

  _paintStrip() {
    const g = this.stripG;
    g.clear();
    const pal = this.theme.pal;
    g.fillStyle(pal.bg, 0.6);
    g.fillRect(0, 59, GAME_WIDTH, 17);
    g.fillStyle(pal[this.stripKey || 'cyan'], 0.9);
    g.fillRect(0, 59, GAME_WIDTH, 1);
    g.fillRect(0, 75, GAME_WIDTH, 1);
  }

  _paintHint() {
    const g = this.hintG;
    g.clear();
    if (!this.hintChip.w) return;
    const pal = this.theme.pal;
    const w = this.hintChip.w;
    const x = this.hintX || Math.round(GAME_WIDTH / 2 - w / 2);
    const y = this.hintY;
    g.fillStyle(pal.bg, 0.78);
    g.fillRect(x, y, w, 13);
    strokeRectPx(g, x, y, w, 13, pal[this.hintChip.key], 0.9);
  }

  _paintPowerups() {
    const g = this.powerG;
    const pal = this.theme.pal;
    g.clear();
    let i = 0;
    for (const [id, p] of this.powerups) {
      const key = this._powerColor(id);
      const c = pal[key];
      const x = this.powerX + i * POWER_PITCH;
      const y = POWER_Y;
      const blink = p.total > 0 && p.remaining < 1000 && Math.floor(this.nowMs / 120) % 2 === 0;
      g.fillStyle(pal.bg, 0.75);
      g.fillRect(x, y, 20, 20);
      strokeRectPx(g, x, y, 20, 20, c, blink ? 0.3 : 1);
      this._drawIcon(g, id, x + 10, y + 10, c);
      if (p.total > 0) {
        g.fillStyle(pal.bgAlt, 1);
        g.fillRect(x, y + 22, 20, 3);
        g.fillStyle(c, blink ? 0.4 : 1);
        g.fillRect(x, y + 22, Math.round(20 * Math.max(0, Math.min(1, p.remaining / p.total))), 3);
      }
      p.slot = i;
      p.sx = x;
      i++;
    }
  }

  /** Effect kind of a power-up id from content ('' when unknown). */
  _powerKind(id) {
    const d = this.content && this.content.powerups && this.content.powerups[id];
    return (d && d.effect && d.effect.kind) || '';
  }

  /** HUD info for a power-up id: its own POWERUP_INFO row, else its kind's (B0), else a cyan chip named after the id. */
  _powerInfo(id) {
    if (POWERUP_INFO[id]) return POWERUP_INFO[id];
    const k = POWERUP_KIND_INFO[this._powerKind(id)];
    return { name: idToLabel(id), color: k ? k.color : 'cyan' };
  }

  _drawIcon(g, id, cx, cy, c) {
    g.lineStyle(1, c, 1);
    g.fillStyle(c, 1);
    const kind = POWERUP_INFO[id] ? '' : this._powerKind(id);
    if (kind === 'ward') {
      // ward: a ring with a bar through it ("this mechanic is off")
      g.strokeCircle(cx, cy, 6);
      g.lineBetween(cx - 4, cy + 4, cx + 4, cy - 4);
    } else if (kind === 'glide') {
      // glide: two runner lines with a speed tick
      g.lineBetween(cx - 6, cy + 2, cx + 5, cy + 2);
      g.lineBetween(cx - 4, cy + 5, cx + 6, cy + 5);
      g.fillTriangle(cx - 2, cy - 6, cx - 2, cy - 1, cx + 4, cy - 3.5);
    } else if (kind === 'stabilize') {
      // stabilize: a level bar on a pivot
      g.lineBetween(cx - 6, cy - 1, cx + 6, cy - 1);
      g.fillTriangle(cx, cy, cx - 4, cy + 6, cx + 4, cy + 6);
    } else if (id === 'clockPulse') {
      g.strokeCircle(cx, cy, 6);
      g.lineBetween(cx, cy, cx, cy - 4);
      g.lineBetween(cx, cy, cx + 3, cy + 1);
    } else if (id === 'packetBurst') {
      g.fillTriangle(cx - 5, cy - 6, cx - 5, cy + 6, cx, cy);
      g.fillTriangle(cx, cy - 6, cx, cy + 6, cx + 5, cy);
    } else if (id === 'hashedBackup') {
      g.beginPath();
      g.moveTo(cx - 5, cy - 6);
      g.lineTo(cx + 5, cy - 6);
      g.lineTo(cx + 5, cy + 1);
      g.lineTo(cx, cy + 6);
      g.lineTo(cx - 5, cy + 1);
      g.closePath();
      g.strokePath();
      g.fillRect(cx - 1, cy - 3, 2, 5);
    } else {
      g.strokeRect(cx - 5, cy - 5, 10, 10);
    }
  }

  // ---------------------------------------------------------------- events

  onRunStart(p) {
    this.missionToastsThisRun.clear();
    this.runId = (p && p.runId) || '';
    this.score = 0;
    this.meters = 0;
    this.speedMs = 0;
    this.lastDist = { m: 0, t: this.nowMs };
    this.multiplier = 1;
    this.scoreText.setText('0');
    this.distText.setText('0 M');
    this.speedText.setText('0 KM/H');
    this.comboText.setText(fmtMult(1)).setColorKey('lime');
    this.comboInfo.setText('');
    this._setPending(0);
    this.shards = 0;
    this.chain = 0;
    this.shardText.setVisible(false);
    this.chainText.setVisible(false);
    this._setFlow(1, 0);
    this.tweens.killTweensOf(this.flowLostText);
    this.flowLostText.setAlpha(0);
    this.tweens.killTweensOf(this.bankLine);
    this.bankLine.setAlpha(0);
    this.bestShown = false;
    this._hideHint();
    for (const id of [...this.powerups.keys()]) this._removePowerup(id);
    for (const k of [...this.effects.keys()]) this._removeEffect(k);
    this.zones = [];
    this._refreshZone();
    this.frozen = false;
    this.tweens.resumeAll();
    if (p) {
      this.dailyRuleId = p.dailyRuleId || this.dailyRuleId;
      this._buildSeedInfo(p.seed);
    }
  }

  onRunEnd() {
    this.comboInfo.setText('');
    this._setPending(0);
    this._toastMissions();
  }

  /**
   * W2: a mission was completed mid-run. Shares the milestone strip queue so HUD stacking is
   * unchanged and the toast cannot collide with a MILESTONE or NEW BEST slide.
   * @param {{id:string,title?:string,xp?:number,shards?:number}} p
   */
  onMissionCompleted(p) {
    if (!p) return;
    if (p.id) this.missionToastsThisRun.add(p.id);
    this._strip(missionToastText(p, p.title), 'lime', { mission: p });
  }

  /**
   * Run-end mission toast. RunScene stops this HUD CRASH_TO_GAMEOVER_MS (950 ms) after RUN_END, and one strip
   * already takes 940 ms, so a second queued toast was always cut off (audit UI-3). Every completion not
   * already toasted mid-run is folded into ONE strip ("2 MISSIONS DONE  +100 XP"; a single one keeps its
   * title), together with any mid-run mission toast still waiting in the queue, run on the shorter RUN_END
   * timing and put ahead of any stale strip still waiting in the queue.
   * Game Over lists the missions by name right after. ProgressionService has already published the awards
   * by the time RUN_END reaches this scene (it is registered first in createServices); if it somehow has
   * not, nothing is toasted rather than throwing at run end.
   */
  _toastMissions() {
    try {
      const awards = this.registry.get(REG.LAST_AWARDS);
      const done = awards && awards.missions && Array.isArray(awards.missions.completed)
        ? awards.missions.completed : [];
      // Mid-run toasts that have not started sliding yet would be cut off too: fold them in.
      const fresh = this.stripQueue.filter((j) => j.mission).map((j) => j.mission);
      this.stripQueue = this.stripQueue.filter((j) => !j.mission);
      for (const c of done) {
        if (!c) continue;
        if (c.id && this.missionToastsThisRun.has(c.id)) continue;
        if (c.id) this.missionToastsThisRun.add(c.id);
        fresh.push(c);
      }
      if (!fresh.length) return;
      const text = fresh.length === 1
        ? missionToastText(fresh[0], fresh[0].title)
        : stripToastText(`${fresh.length} MISSIONS`, fresh.reduce((n, c) => n + (Number(c.xp) || 0), 0));
      this._strip(text, 'lime', { front: true, timing: STRIP_TIMING.runEnd });
    } catch (e) { /* cosmetic */ }
  }

  onScore(p) {
    const prev = this.score;
    this.score = p.total || 0;
    this.scoreText.setText(fmtInt(this.score));
    if (this.score - prev >= 40) this._pop(this.scoreText, 2, 2.4);
  }

  onCombo(p) {
    const m = p.multiplier || 1;
    const grew = m > this.multiplier + 1e-6;
    this.multiplier = m;
    this.comboText.setText(fmtMult(m));
    this.comboText.setColorKey(m >= 2.5 ? 'magenta' : m >= 1.5 ? 'amber' : 'lime');
    const n = (p.tricks && p.tricks.length) || 0;
    this.comboInfo.setText(n > 0 ? `${n} TRICK${n > 1 ? 'S' : ''} PENDING` : '');
    if (grew) this._pop(this.comboText, 2, 2.5);
    this._setPending(n > 0 ? p.pendingPoints || 0 : 0);
  }

  _setPending(raw, quiet) {
    const prev = this.pending;
    this.pendingRaw = raw;
    // what a clean landing would bank: pending x combo x the flow carried in
    this.pending = Math.round(raw * (this.multiplier || 1) * (this.flow || 1));
    if (this.pending <= 0) {
      this.pendingText.setText('');
      return;
    }
    this.pendingText.setText(`+${fmtInt(this.pending)}`);
    if (this.pending > prev && !quiet) this._pop(this.pendingText, 2, 2.3);
  }

  onBoost(p) {
    if (!p) return;
    const perfect = p.quality === 'perfect';
    const t = this.boostText;
    this.tweens.killTweensOf(t);
    t.setText(`BOOST +${fmtInt(Math.round(p.amountPxS || 0))}`).setColorKey(perfect ? 'amber' : 'lime');
    const base = perfect ? 3 : 2;
    this.boostScale = base;
    t.__snap = true;
    // pops about its centre by 25 %: stays inside the gap to the next slot
    t.setAlpha(1).setScale(base * 1.25);
    this.tweens.add({ targets: t, scaleX: base, scaleY: base, duration: 150, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: perfect ? 900 : 600, duration: 300 });
    // speed readout flash
    this.speedText.setColorKey('amber');
    this._pop(this.speedText, 1, perfect ? 1.4 : 1.3); // the shard row is 12 px below: a bigger pop would run into it
    this.time.delayedCall(450, () => { if (this.speedText.scene) this.speedText.setColorKey('cyan'); });
    uiSfx(this, 'boost', { intensity: perfect ? 1 : 0.35 });
  }

  onNearMiss(p) {
    this._popup(`NEAR MISS +${fmtInt((p && p.points) || 25)}`, 'magenta');
    uiSfx(this, 'nearMiss');
  }

  onShard(p) {
    if (!p) return;
    this.shards = p.count != null ? p.count : this.shards + 1;
    this.chain = p.chain || 0;
    this.chainUntil = this.nowMs + CHAIN_LIFE_MS;
    this.shardLabel = `SHARDS ${fmtInt(this.shards)}`;
    this.shardText.setText(this.shardLabel).setVisible(true);
    this._pop(this.shardText, 1, 1.4);
    const show = this.chain > 1;
    this.chainText.setVisible(show);
    if (show) {
      this.chainText.setText(`x${this.chain}`);
      this._pop(this.chainText, 1, 1.5);
    }
    uiSfx(this, 'shard', { step: Math.max(0, this.chain - 1) });
  }

  onMilestone(p) {
    const pts = p && p.points > 0 ? `  +${fmtInt(p.points)}` : '';
    this._strip(`SECTOR ${(p && p.sector) || ''}${pts}`, 'cyan');
    uiSfx(this, 'milestone');
  }

  onBiomeEnter(p) {
    if (!p || !p.name) return;
    if (p.entering) this._strip(p.name.toUpperCase(), 'magenta');
    else this._strip('BITSTREAM', 'cyan');
  }

  onNewBest() {
    if (this.bestShown) return;
    this.bestShown = true;
    this._strip('NEW BEST DISTANCE', 'amber');
    uiSfx(this, 'newBest');
  }

  onHint(p) {
    if (!p) return;
    if (!p.show) {
      if (this.hintId === p.id) this._hideHint();
      return;
    }
    const router = this.registry.get(REG.INPUT);
    const ov = router && router.pad && router.pad.overlay;
    const src = router && router.pad && router.pad.state && router.pad.state.lastSource;
    const mode = (ov && ov.isVisible && ov.isVisible()) || src === 'touch' ? 'touch' : src === 'gamepad' ? 'gamepad' : 'keyboard';
    const label = HINT_TEXT[mode][p.id] || '';
    if (!label) return;
    this.hintId = p.id;
    this.hintX = 0; // _layout picks the free spot on the next frame
    this.hintY = HINT_ROWS[0];
    this.hintT.setText(label).setVisible(true);
    this.hintChip = { w: measureText(label) + 14, key: 'cyan' };
    this.hintG.setVisible(true);
    this._paintHint();
    this.hintUntil = this.nowMs + HINT_MAX_MS;
  }

  _hideHint() {
    this.hintId = null;
    this.hintUntil = 0;
    this.hintChip.w = 0;
    this.hintG.setVisible(false);
    this.hintT.setVisible(false);
    this._paintHint();
  }

  /**
   * @param {string} text
   * @param {string} key palette key
   * @param {{front?:boolean, timing?:{inMs:number,holdMs:number,outMs:number}, mission?:Object}} [o]
   *   front = jump the queue; mission = the completion this toast announces (so RUN_END can fold it)
   */
  _strip(text, key, o = {}) {
    const job = { text, key, timing: o.timing || STRIP_TIMING.normal };
    if (o.mission) job.mission = o.mission;
    if (o.front) this.stripQueue.unshift(job);
    else this.stripQueue.push(job);
    if (!this.stripBusy) this._nextStrip();
  }

  _nextStrip() {
    const job = this.stripQueue.shift();
    if (!job) {
      this.stripBusy = false;
      return;
    }
    this.stripBusy = true;
    this.stripKey = job.key;
    this._paintStrip();
    this.stripT.setText(job.text).setColorKey(job.key);
    const c = this.stripC;
    this.tweens.killTweensOf(c);
    c.__snap = true;
    c.setVisible(true).setX(-GAME_WIDTH);
    // normal: slide in 220 ms, hold 500 ms, slide out 220 ms (< 1 s total); RUN_END: shorter, see STRIP_TIMING
    const tm = job.timing || STRIP_TIMING.normal;
    this.tweens.add({ targets: c, x: 0, duration: tm.inMs, ease: 'Cubic.easeOut' });
    this.tweens.add({
      targets: c, x: GAME_WIDTH, delay: tm.inMs + tm.holdMs, duration: tm.outMs, ease: 'Cubic.easeIn',
      onComplete: () => { c.setVisible(false); this._nextStrip(); },
    });
  }

  onDistance(p) {
    const m = p.meters || 0;
    this.meters = m;
    this.distText.setText(`${fmtInt(m)} M`);
    if (this.nowMs < this.exactSpeedUntil) return;
    const dt = (this.nowMs - this.lastDist.t) / 1000;
    if (dt > 0.05 && dt < 2) {
      const v = (m - this.lastDist.m) / dt;
      this.speedMs = this.speedMs ? this.speedMs * 0.6 + v * 0.4 : v;
      this.speedText.setText(`${fmtInt(Math.max(0, this.speedMs) * 3.6)} KM/H`);
    }
    this.lastDist = { m, t: this.nowMs };
  }

  onSpeed(p) {
    if (!p) return;
    this.exactSpeedUntil = this.nowMs + 600;
    this.speedMs = (p.speedPxS || 0) / PIXELS_PER_METER;
    this.speedText.setText(`${fmtInt(this.speedMs * 3.6)} KM/H`);
    // flow resync (also covers a missed FLOW_* event and a timeout refresh at the x3.0 cap)
    if (p.flow != null) {
      if (p.flow > 1.001 && (Math.abs(p.flow - this.flow) > 1e-6 || Math.abs((p.flowFrac || 0) - this.flowFrac) > 0.02)) {
        this._setFlow(p.flow, p.flowFrac || 0);
      } else if (p.flow <= 1.001 && this.flow > 1.001) {
        this._setFlow(1, 0);
      }
    }
  }

  onTrick(p) {
    const name = TRICK_NAMES[p.type] || idToLabel(p.type);
    const count = p.count > 1 ? ` X${p.count}` : '';
    this._popup(`${p.isNew ? 'NEW ' : ''}${name}${count} +${fmtInt(p.value)}`, p.isNew ? 'lime' : 'cyan');
  }

  onLanding(p) {
    const banked = p.bankedPoints || 0;
    if (p.midSpin) this._popup('SPIN CUT  GRADE DOWN', 'magenta');
    if (p.quality === 'perfect') {
      const bonus = p.bonusPoints || 20;
      this._flash(`PERFECT LANDING +${bonus}`);
      if (banked > 0) this._bank(this._bankText(p, banked, ''), 'amber');
    } else if (p.quality === 'good') {
      if (banked > 0) this._bank(this._bankText(p, banked, ''), 'text');
    } else if (p.quality === 'sloppy') {
      this._bank(banked > 0 ? this._bankText(p, banked, 'SLOPPY ') : 'SLOPPY LANDING', 'amber');
    }
  }

  /** Show the landing payoff line (scale 2, glow), replacing the previous one. */
  _bank(text, color) {
    const t = this.bankLine;
    this.tweens.killTweensOf(t);
    t.__snap = true;
    t.setText(text).setColorKey(color).setAlpha(1).setScale(2.5);
    this.tweens.add({ targets: t, scaleX: 2, scaleY: 2, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 350 });
  }

  /**
   * "DOUBLE BACKFLIP + HELI x1.5 +450": named combo, combo multiplier when above x1, banked points. Always fits 480 px
   * at the bank line's scale 2 (shortened step by step: drop prefix, mult, name).
   */
  _bankText(p, banked, prefix) {
    const name = p.comboName || '';
    const mult = p.comboMult > 1.001 ? ` x${fmtShort(p.comboMult)}` : '';
    const pts = ` +${fmtInt(banked)}`;
    const tries = [
      `${prefix}${name || 'BANKED'}${mult}${pts}`,
      `${name || 'BANKED'}${mult}${pts}`,
      `${name || 'BANKED'}${pts}`,
      `BANKED${pts}`,
    ];
    return tries.find((t) => measureText(t) * 2 <= POPUP_MAX_W) || tries[tries.length - 1];
  }

  // ---------------------------------------------------------------- flow

  /** Apply flow state to the meter: visibility, text, colour. frac = remaining timeout 0..1. */
  _setFlow(flow, frac) {
    this.flow = flow;
    this.flowFrac = Math.max(0, Math.min(1, frac));
    const on = flow > 1.001;
    this.flowText.setVisible(on);
    this.flowG.setVisible(on);
    if (on) {
      this.flowText.setText(`FLOW x${flow.toFixed(2)}`).setColorKey(flowColor(flow));
      this._paintFlow();
    }
    this._setPending(this.pendingRaw, true);
  }

  _paintFlow() {
    const g = this.flowG;
    g.clear();
    if (this.flow <= 1.001) return;
    const pal = this.theme.pal;
    const x = GAME_WIDTH - 8 - FLOW_BAR_W;
    const y = FLOW_Y + 10;
    const low = this.flowFrac < 0.25 && Math.floor(this.nowMs / 110) % 2 === 0;
    const c = pal[low ? 'danger' : flowColor(this.flow)];
    g.fillStyle(pal.bg, 0.75);
    g.fillRect(x - 1, y - 1, FLOW_BAR_W + 2, 5);
    g.fillStyle(pal.bgAlt, 1);
    g.fillRect(x, y, FLOW_BAR_W, 3);
    g.fillStyle(c, 1);
    g.fillRect(x, y, Math.round(FLOW_BAR_W * this.flowFrac), 3);
  }

  onFlowChanged(p) {
    if (!p) return;
    const flow = p.flow || 1;
    const rose = flow > this.flow + 1e-6;
    const step = Math.floor(flow * 2); // colour steps at 1.5 / 2 / 2.5
    this._setFlow(flow, p.timeoutFrac != null ? p.timeoutFrac : 1);
    if (flow > 1.001) {
      this.tweens.killTweensOf(this.flowText);
      this.flowText.setAlpha(1);
      if (rose) {
        this._pop(this.flowText, 1, step > this.flowStep ? 2.6 : 1.8);
        uiSfx(this, 'flowUp', { flow });
      } else {
        // sloppy landing, shield hit or timeout halving: partly lost (the bar was refilled by the event's timeoutFrac)
        this._pop(this.flowText, 1, 1.4);
        uiSfx(this, 'uiBack', { pitch: 0.8, volume: 0.6 });
        if (p.reason === 'timeout') {
          this.flowText.setColorKey('danger');
          this.time.delayedCall(350, () => {
            if (this.flowText.scene && this.flow > 1.001) this.flowText.setColorKey(flowColor(this.flow));
          });
        }
      }
    }
    this.flowStep = step;
  }

  onFlowLost() {
    this._setFlow(1, 0);
    this.flowStep = 0;
    const t = this.flowLostText;
    this.tweens.killTweensOf(t);
    t.setY(FLOW_Y).setAlpha(1).setScale(1.6);
    this.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 150, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: FLOW_Y + 6, delay: 800, duration: 300 });
    uiSfx(this, 'flowLost');
  }

  onPowerCollected(p) {
    const id = p.id;
    const total = p.durationMs || 0;
    const old = this.powerups.get(id);
    if (old) old.text.destroy();
    const info = this._powerInfo(id);
    const t = this._t(0, GAME_HEIGHT - 26, '', { color: 'text', outline: 'dark' });
    this.powerups.set(id, { total, remaining: total, charges: p.charges || 0, text: t });
    this._paintPowerups();
    this._layoutPowerups();
    this._popup(info.name, this._powerColor(id));
  }

  _powerColor(id) {
    const info = this._powerInfo(id);
    return (this.content.powerups && this.content.powerups[id] && this.content.powerups[id].colorKey) || info.color;
  }

  onPowerExpired(p) {
    if (this.powerups.has(p.id)) this._removePowerup(p.id);
  }

  _removePowerup(id) {
    const e = this.powerups.get(id);
    if (e) e.text.destroy();
    this.powerups.delete(id);
    this._paintPowerups();
    this._layoutPowerups();
  }

  _layoutPowerups() {
    let i = 0;
    for (const [, p] of this.powerups) {
      p.text.setPosition(this.powerX + i * POWER_PITCH + 24, GAME_HEIGHT - 24);
      i++;
    }
  }

  onHazard(p) {
    if (p.effect === 'crash') return;
    const info = EFFECT_INFO[p.effect];
    if (!info) return;
    const dur = Math.max(p.durationMs || 0, info.showMs || 0);
    let e = this.effects.get(p.effect);
    if (!e) {
      const t = this._t(GAME_WIDTH / 2, this.warnY + this.effects.size * 11, '', { color: info.color, anchor: 'center', outline: 'dark' });
      t.__snap = true;
      e = { text: t, remaining: 0, total: 0 };
      this.effects.set(p.effect, e);
    }
    e.remaining = e.total = dur;
    this._updateEffect(p.effect, e);
  }

  _updateEffect(key, e) {
    const info = EFFECT_INFO[key];
    e.text.setText(`!! ${info.label} ${fmtSec(e.remaining)} !!`);
    e.text.setColorKey(Math.floor(this.nowMs / 150) % 2 === 0 ? info.color : 'text');
  }

  onEffectEnd(p) {
    if (p && this.effects.has(p.effect)) this._removeEffect(p.effect);
  }

  _removeEffect(key) {
    const e = this.effects.get(key);
    if (e) e.text.destroy();
    this.effects.delete(key); // the rest glide up in _layout
  }

  onZoneEnter(p) {
    this.zones = this.zones.filter((z) => z.modId !== p.modId);
    this.zones.push({ modId: p.modId });
    this._refreshZone();
    const info = ZONE_INFO[p.modId];
    if (info) this._pop(this.zoneText, 1, 1.5);
  }

  onZoneExit(p) {
    this.zones = this.zones.filter((z) => z.modId !== p.modId);
    this._refreshZone();
  }

  _refreshZone() {
    const z = this.zones[this.zones.length - 1];
    if (!z) {
      this.zoneChip.w = 0;
      this.zoneG.setVisible(false);
      this.zoneText.setVisible(false);
      this._paintZone();
      return;
    }
    const info = ZONE_INFO[z.modId] || { name: idToLabel(z.modId), sub: '', color: 'cyan' };
    const mod = this.content.terrainMods && this.content.terrainMods[z.modId];
    const key = (mod && mod.colorKey) || info.color;
    const label = info.sub ? `${info.name} // ${info.sub}` : info.name;
    this.zoneText.setText(label).setColorKey(key);
    this.zoneChip = { w: measureText(label) + 14, key };
    this.zoneG.setVisible(true);
    this.zoneText.setVisible(true);
    this._paintZone();
  }

  onGlitchStart(p) {
    this.glitchUntil = this.nowMs + Math.min(250, (p && p.durationMs) || 100);
    this.glitchPower = Math.max(1, Math.round(((p && p.intensity) || 0.5) * 4));
  }

  onGlitchEnd() {
    this.glitchUntil = 0;
    this.hud.setPosition(0, 0).setAlpha(1);
  }

  onCrash(p) {
    if (p && p.negated) {
      this._banner('HASHED BACKUP USED', 'amber', 1);
    } else {
      this._banner('CRASH', 'danger', 3);
      this.comboInfo.setText('');
    }
  }

  onRespawn(p) {
    if (p && p.reason === 'manual') this._popup(p.comboPenalty > 0 ? `RESET  -${p.comboPenalty} COMBO` : 'RESET', 'amber');
  }

  onPause() {
    this.frozen = true;
    this.tweens.pauseAll();
  }

  onResume() {
    this.frozen = false;
    this.tweens.resumeAll();
  }

  // ---------------------------------------------------------------- effects

  _pop(textObj, base, peak) {
    this.tweens.killTweensOf(textObj);
    textObj.setScale(peak);
    this.tweens.add({ targets: textObj, scaleX: base, scaleY: base, duration: 220, ease: 'Back.easeOut' });
  }

  _flash(text) {
    const f = this.flash;
    this.tweens.killTweensOf(f);
    f.__snap = true;
    f.setText(text).setAlpha(1).setScale(2.5);
    this.tweens.add({ targets: f, scaleX: 2, scaleY: 2, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: f, alpha: 0, delay: 750, duration: 300 });
  }

  _banner(text, color, scale) {
    const b = this.banner;
    this.tweens.killTweensOf(b);
    this.bannerScale = scale;
    b.__snap = true;
    b.setText(text).setColorKey(color).setScale(scale * 1.25).setAlpha(1);
    this.tweens.add({ targets: b, scaleX: scale, scaleY: scale, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: b, alpha: 0, delay: 900, duration: 250 });
  }

  _popup(text, color) {
    // older popups drop one slot (positions come from _layout, which glides them down)
    for (const p of this.popups) this.tweens.killTweensOf(p);
    const t = this._t(GAME_WIDTH / 2, POPUP_Y, text, { color, anchor: 'center', outline: 'dark' });
    t.__snap = true;
    t.setScale(1.25);
    this.popups.unshift(t);
    this.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: t, alpha: 0, delay: 650, duration: 350,
      onComplete: () => this._dropPopup(t),
    });
    while (this.popups.length > MAX_POPUPS) this._dropPopup(this.popups[this.popups.length - 1]);
    // earlier popups keep fading from where they are
    for (const p of this.popups) {
      if (p !== t) {
        this.tweens.add({ targets: p, alpha: 0, delay: 400, duration: 300, onComplete: () => this._dropPopup(p) });
      }
    }
  }

  _dropPopup(t) {
    const i = this.popups.indexOf(t);
    if (i >= 0) this.popups.splice(i, 1);
    this.tweens.killTweensOf(t);
    if (t.scene) t.destroy();
  }

  // ---------------------------------------------------------------- layout

  /** Screen box of a NeonText (game px), from its current scale and anchor. */
  _trect(nt) {
    const s = nt.scaleX;
    const w = measureText(nt.main.text) * s;
    const h = 8 * s;
    return { x: nt.x - w * nt.main.originX, y: nt.y - h * nt.main.originY, w, h };
  }

  _shown(nt) {
    return nt.visible && nt.alpha > 0.03 && !!nt.main.text;
  }

  /** Boxes of the fixed HUD rows that are showing (what the centre banners must not touch). */
  _fixedRects() {
    const out = [];
    for (const nt of [this.scoreLabel, this.scoreText, this.distText, this.speedText, this.shardText, this.chainText,
      this.comboLabel, this.comboText, this.comboInfo, this.pendingText, this.flowText, this.flowLostText]) {
      if (this._shown(nt)) out.push(this._trect(nt));
    }
    if (this.flowG.visible) out.push({ x: GAME_WIDTH - 8 - FLOW_BAR_W - 1, y: FLOW_Y + 9, w: FLOW_BAR_W + 2, h: 5 });
    return out;
  }

  /** Boxes (game px) of the on-screen touch buttons, read from the DOM overlay and mapped through the canvas rectangle. */
  _refreshTouchRects() {
    this.touchAt = this.nowMs;
    const router = this.registry.get(REG.INPUT);
    const ov = router && router.pad && router.pad.overlay;
    const root = ov && ov.isVisible && ov.isVisible() && ov.root;
    const canvas = this.game.canvas;
    const out = [];
    if (root && root.querySelectorAll && canvas && canvas.getBoundingClientRect) {
      const cr = canvas.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) {
        const sx = GAME_WIDTH / cr.width;
        const sy = GAME_HEIGHT / cr.height;
        for (const el of root.querySelectorAll('.bb-cl')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push({ x: (r.left - cr.left) * sx, y: (r.top - cr.top) * sy, w: r.width * sx, h: r.height * sy });
        }
      }
    }
    this.touchRects = out;
  }

  _glide(obj, ty, dt) {
    if (obj.__snap || obj.__laid === undefined) {
      obj.__snap = false;
      obj.__laid = true;
      obj.y = ty;
      return;
    }
    const d = ty - obj.y;
    obj.y = Math.abs(d) < 1 ? ty : Math.round(obj.y + d * Math.min(1, dt / 70));
  }

  /** Stack the centre slots and place the bottom row. Called every frame; cheap (a dozen rectangles). */
  _layout(dt) {
    if (this.nowMs - this.touchAt > 500) this._refreshTouchRects();
    const cx = GAME_WIDTH / 2;
    const touch = this.touchRects;
    const keep = this._fixedRects().concat(touch);

    // zone chip: top centre, below the touch pause / reset buttons when those are up
    let chipBox = null;
    if (this.zoneChip.w) {
      const w = this.zoneChip.w + 8;
      const y = stackY([{ w, h: 13, pref: 3 }], { cx, gap: 3, keepOuts: touch })[0];
      if (y !== this.zoneY) {
        this.zoneY = y;
        this._paintZone();
      }
      this.zoneText.setY(y + 3);
      chipBox = { x: cx - w / 2, y, w, h: 13 };
    } else this.zoneY = 3;
    if (chipBox) keep.push(chipBox);

    // centre stack, in priority order; each entry is {obj, w, h, pref, kind}
    const slots = [];
    const add = (obj, w, h, pref, kind) => slots.push({ obj, w, h, pref, kind });
    for (const e of this.effects.values()) add(e.text, measureText(e.text.main.text), 8, SLOT.warn, 'top');
    if (this._shown(this.boostText)) add(this.boostText, measureText(this.boostText.main.text) * this.boostScale, 8 * this.boostScale, SLOT.boost, 'mid');
    if (this._shown(this.flash)) add(this.flash, measureText(this.flash.main.text) * 2, 16, SLOT.flash, 'mid');
    // The strip is a FULL-WIDTH band, not a text box: its background fill crosses the whole row, so measuring
    // only its text (the W2 defect) let it paint over "FLOW x1.25" and the trick popups. It takes its slot in
    // this same stack (between the flash and the bank line, in SLOT order) as a `full` item, tested across
    // the whole row. It used to be placed separately with placeBand, which ignored the stack, so it sat on
    // the PERFECT flash, the bank line and the CRASH banner (audit U5a/b/c).
    const stripUp = this.stripC.visible && Boolean(this.stripT.main.text);
    if (stripUp) slots.push({ obj: this.stripC, w: GAME_WIDTH, h: STRIP_BAND.h, pref: SLOT.strip, kind: 'band', full: true });
    if (this._shown(this.bankLine)) add(this.bankLine, measureText(this.bankLine.main.text) * 2, 16, SLOT.bank, 'mid');
    if (this._shown(this.banner)) add(this.banner, measureText(this.banner.main.text) * this.bannerScale, 8 * this.bannerScale, SLOT.banner, 'mid');
    for (const p of this.popups) add(p, measureText(p.main.text), 8, SLOT.popup, 'top');
    const ys = stackY(slots, { cx, startY: 0, gap: 3, width: GAME_WIDTH, keepOuts: keep });
    slots.forEach((sl, i) => {
      if (sl.kind === 'band') {
        // The container's band is drawn at local y 59..76 and its text at local y 61: shift so the BAND
        // top lands on its stacked y. Never lower than the screen allows.
        const bandTop = Math.min(ys[i], Math.max(SLOT.strip, GAME_HEIGHT - sl.h));
        const ty = bandTop - SLOT.strip;
        if (this.stripC.__snap) { this.stripC.__snap = false; this.stripC.y = ty; } else this.stripC.y += (ty - this.stripC.y) * Math.min(1, dt / 70);
        return;
      }
      this._glide(sl.obj, sl.kind === 'mid' ? ys[i] + sl.h / 2 : ys[i], dt);
    });

    // bottom row: power-up timers (clear of the touch buttons), then the tutorial chip (clear of both and of the seed lines)
    const n = this.powerups.size;
    const rowW = n ? (n - 1) * POWER_PITCH + 56 : 0;
    let px = 8;
    if (n) {
      const free = placeX(rowW, POWER_Y, 26, 8, touch, { min: 8, max: GAME_WIDTH - 8 });
      px = free === null ? 8 : free;
    }
    if (px !== this.powerX) {
      this.powerX = px;
      this._paintPowerups();
      this._layoutPowerups();
    }
    const bottom = touch.slice();
    if (n) bottom.push({ x: px, y: POWER_Y, w: rowW, h: 26 });
    if (this.seedText && this.seedText.visible) bottom.push(this._trect(this.seedText), this._trect(this.ruleText));
    if (this.hintChip.w) {
      const w = this.hintChip.w;
      let hx = null;
      let hy = HINT_ROWS[0];
      for (const row of HINT_ROWS) {
        hy = row;
        hx = placeX(w, row, 13, Math.round(cx - w / 2), bottom, { min: 4, max: GAME_WIDTH - 4 });
        if (hx !== null) break;
      }
      if (hx === null) hx = Math.round(cx - w / 2);
      if (hx !== this.hintX || hy !== this.hintY) {
        this.hintX = hx;
        this.hintY = hy;
        this._paintHint();
      }
      this.hintT.setPosition(hx + w / 2, hy + 4);
    }
    // the shard chain chip follows the (popping) shard counter
    if (this.chainText.visible) this.chainText.setX(8 + measureText(this.shardLabel) * this.shardText.scaleX + 6);
  }

  // ---------------------------------------------------------------- frame

  update(time, delta) {
    if (this.frozen) return;
    this.nowMs += delta;
    // power-up timers
    let dirty = false;
    for (const [id, p] of [...this.powerups]) {
      if (p.total > 0) {
        p.remaining -= delta;
        if (p.remaining <= 0) {
          this._removePowerup(id);
          continue;
        }
        p.text.setText(`${fmtSec(p.remaining)}S`);
        dirty = true;
      } else {
        p.text.setText(`x${p.charges || 1}`);
      }
    }
    if (dirty) this._paintPowerups();
    // effect timers
    for (const [key, e] of [...this.effects]) {
      e.remaining -= delta;
      if (e.remaining <= 0) this._removeEffect(key);
      else this._updateEffect(key, e);
    }
    // speed decays when no distance ticks arrive
    if (this.nowMs >= this.exactSpeedUntil && this.nowMs - this.lastDist.t > 1500 && this.speedMs > 0) {
      this.speedMs = 0;
      this.speedText.setText('0 KM/H');
    }
    // the on-screen touch controls own the bottom-right corner: hide the seed / daily rule lines while they are shown
    const router = this.registry.get(REG.INPUT);
    const ov = router && router.pad && router.pad.overlay;
    const covered = !!(ov && ov.isVisible && ov.isVisible());
    if (this.seedText && this.seedText.visible === covered) {
      this.seedText.setVisible(!covered);
      this.ruleText.setVisible(!covered);
    }
    // glitch jitter of the HUD (subtle)
    if (this.nowMs < this.glitchUntil) {
      this.hud.setPosition(Phaser.Math.Between(-this.glitchPower, this.glitchPower), 0);
      this.hud.setAlpha(Math.random() < 0.3 ? 0.6 : 1);
    } else if (this.hud.x !== 0 || this.hud.alpha !== 1) {
      this.hud.setPosition(0, 0).setAlpha(1);
    }
    // flow timeout drains in run time (resynced ~10 Hz by HUD_SPEED_EVENT)
    if (this.flow > 1.001) {
      this.flowFrac = Math.max(0, this.flowFrac - delta / SCORING.flowTimeoutMs);
      this._paintFlow();
    }
    this._layout(delta);
    // zone chip pulse
    if (this.zoneText.visible) this.zoneG.setAlpha(0.75 + 0.25 * Math.sin(this.nowMs * 0.008));
    // tutorial chip fallback timeout, shard chain expiry
    if (this.hintId && this.nowMs > this.hintUntil) this._hideHint();
    if (this.chain > 0 && this.nowMs > this.chainUntil) {
      this.chain = 0;
      this.chainText.setVisible(false);
    }
    // combo urgency: pending points pulse while the multiplier is above x1
    if (this.pending > 0) {
      if (this.multiplier > 1.01) {
        const k = Math.sin(this.nowMs * (0.012 + (this.multiplier - 1) * 0.004));
        this.pendingText.setAlpha(0.7 + 0.3 * k);
        this.pendingText.setColorKey(k > 0.3 ? 'text' : this.multiplier >= 2.5 ? 'magenta' : 'amber');
      } else {
        this.pendingText.setAlpha(1).setColorKey('amber');
      }
    }
  }
}
