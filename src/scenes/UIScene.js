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
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT, PIXELS_PER_METER } from '../constants.js';
import { EVT } from '../events.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { Theme } from '../ui/Theme.js';
import { NeonText, strokeRectPx } from '../ui/Neon.js';
import { measureText } from '../ui/PixelFont.js';
import { addScanlines } from '../ui/Scanlines.js';
import { fmtInt, fmtMult, fmtSec, idToLabel } from '../ui/Format.js';

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
const EFFECT_INFO = {
  scramble: { label: 'PHYSICS SCRAMBLE', color: 'danger' },
  slow: { label: 'SPEED CUT', color: 'amber' },
};

const POPUP_Y = 64;
const POPUP_STEP = 10;
const MAX_POPUPS = 3;

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
    this.flash = this._t(cx, 46, '', { color: 'amber', scale: 2, anchor: 'center', outline: 'glow' });
    this.flash.setAlpha(0);
    this.banner = this._t(cx, 100, '', { color: 'danger', scale: 3, anchor: 'center', vAnchor: 0.5 });
    this.banner.setAlpha(0);
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
    g.fillRect(x, 3, w, 13);
    strokeRectPx(g, x, 3, w, 13, c, 0.9);
    g.fillStyle(c, 1);
    g.fillRect(x - 3, 3, 2, 13);
    g.fillRect(x + w + 1, 3, 2, 13);
  }

  _paintPowerups() {
    const g = this.powerG;
    const pal = this.theme.pal;
    g.clear();
    let i = 0;
    for (const [id, p] of this.powerups) {
      const info = POWERUP_INFO[id] || { color: 'cyan' };
      const key = (this.content.powerups && this.content.powerups[id] && this.content.powerups[id].colorKey) || info.color;
      const c = pal[key];
      const x = 8 + i * 62;
      const y = GAME_HEIGHT - 28;
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

  _drawIcon(g, id, cx, cy, c) {
    g.lineStyle(1, c, 1);
    g.fillStyle(c, 1);
    if (id === 'clockPulse') {
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
    this.comboInfo.setText(n > 0 ? `${n} TRICK${n > 1 ? 'S' : ''} +${fmtInt(p.pendingPoints)}` : '');
    if (grew) this._pop(this.comboText, 2, 3);
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
  }

  onTrick(p) {
    const name = TRICK_NAMES[p.type] || idToLabel(p.type);
    const count = p.count > 1 ? ` X${p.count}` : '';
    this._popup(`${p.isNew ? 'NEW ' : ''}${name}${count} +${fmtInt(p.value)}`, p.isNew ? 'lime' : 'cyan');
  }

  onLanding(p) {
    const banked = p.bankedPoints || 0;
    if (p.quality === 'perfect') {
      const bonus = p.bonusPoints || 20;
      this._flash(`PERFECT LANDING +${bonus}`);
      if (banked > 0) this._popup(`BANKED +${fmtInt(banked)}`, 'amber');
    } else if (p.quality === 'good') {
      if (banked > 0) this._popup(`BANKED +${fmtInt(banked)}`, 'text');
    } else if (p.quality === 'sloppy') {
      this._popup(banked > 0 ? `SLOPPY +${fmtInt(banked)}` : 'SLOPPY LANDING', 'amber');
    }
  }

  onPowerCollected(p) {
    const id = p.id;
    const total = p.durationMs || 0;
    const old = this.powerups.get(id);
    if (old) old.text.destroy();
    const info = POWERUP_INFO[id] || { name: idToLabel(id), color: 'cyan' };
    const t = this._t(0, GAME_HEIGHT - 26, '', { color: 'text', outline: 'dark' });
    this.powerups.set(id, { total, remaining: total, charges: p.charges || 0, text: t });
    this._paintPowerups();
    this._layoutPowerups();
    this._popup(info.name, this._powerColor(id));
  }

  _powerColor(id) {
    const info = POWERUP_INFO[id] || { color: 'cyan' };
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
      p.text.setPosition(8 + i * 62 + 24, GAME_HEIGHT - 24);
      i++;
    }
  }

  onHazard(p) {
    if (p.effect === 'crash') return;
    const info = EFFECT_INFO[p.effect];
    if (!info) return;
    const dur = p.durationMs || 0;
    let e = this.effects.get(p.effect);
    if (!e) {
      const t = this._t(GAME_WIDTH / 2, this.warnY + this.effects.size * 11, '', { color: info.color, anchor: 'center', outline: 'dark' });
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
    this.effects.delete(key);
    let i = 0;
    for (const [, v] of this.effects) v.text.setY(this.warnY + i++ * 11);
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
    f.setText(text).setAlpha(1).setScale(2.6);
    this.tweens.add({ targets: f, scaleX: 2, scaleY: 2, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: f, alpha: 0, delay: 750, duration: 300 });
  }

  _banner(text, color, scale) {
    const b = this.banner;
    this.tweens.killTweensOf(b);
    b.setText(text).setColorKey(color).setScale(scale * 1.4).setAlpha(1);
    this.tweens.add({ targets: b, scaleX: scale, scaleY: scale, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: b, alpha: 0, delay: 900, duration: 250 });
  }

  _popup(text, color) {
    for (const p of this.popups) {
      this.tweens.killTweensOf(p);
      p.y += POPUP_STEP;
    }
    const t = this._t(GAME_WIDTH / 2, POPUP_Y, text, { color, anchor: 'center', outline: 'dark' });
    t.setScale(1.35);
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
    // zone chip pulse
    if (this.zoneText.visible) this.zoneG.setAlpha(0.75 + 0.25 * Math.sin(this.nowMs * 0.008));
  }
}
