/**
 * OWNER: UI engineer.
 * Started by RunScene (`scene.start(SCENES.GAME_OVER)`) after RUN_END. Reads the RunRecord from registry REG.LAST_RECORD
 * (RunScene already called saveStore.saveRun). Shows the score breakdown, ledger hash, share-seed (copyable) and the
 * daily rule. If the run qualifies for the Top-10 (and scored > 0) an initials entry (INITIALS_LENGTH slots, configurable)
 * saves via saveStore.setInitials + updateSetting('lastInitials'); then the leaderboard is shown with the new entry
 * highlighted.
 *
 * INSTANT RETRY: Space / Enter / gamepad A / tap restarts with the SAME seed immediately - input is live from the very
 * first frame and never waits for animations or for the (async) leaderboard queries. While the initials entry is open:
 * Enter saves, Space saves and retries at once, Esc skips. N / X = new seed, Esc / B = title.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT, SCORING } from '../constants.js';
import { updateSetting } from '../services.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { Theme } from '../ui/Theme.js';
import { NeonText } from '../ui/Neon.js';
import { ellipsize } from '../ui/PixelFont.js';
import { Panel } from '../ui/Panel.js';
import { Button } from '../ui/Button.js';
import { MenuInput } from '../ui/MenuInput.js';
import { Backdrop } from '../ui/Backdrop.js';
import { addScanlines } from '../ui/Scanlines.js';
import { InitialsEntry } from '../ui/InitialsEntry.js';
import { LeaderboardTable, ruleLabel } from '../ui/LeaderboardTable.js';
import { copyText } from '../ui/Clipboard.js';
import { fmtInt, fmtClock, fmtMult, fmtSec, randomSeed, INITIALS_LENGTH } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';

const PANEL_Y = 54;
const PANEL_H = 160;
/** RUN REPORT rows start at panel y 56 and must end above the ledger-hash line (y 132: 8 rows end at y 126). */
const ROW_H = 9;
const MAX_ROWS = 8;

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SCENES.GAME_OVER);
  }

  create() {
    this.leaving = false;
    this.alive = true;
    this.entry = null;
    this.saved = false;
    this.rows = [];
    this.rec = this.registry.get(REG.LAST_RECORD) || this._emptyRecord();
    const rec = this.rec;
    const theme = (this.theme = new Theme(this));
    theme.bind((pal) => this.cameras.main.setBackgroundColor(pal.bg));
    this.backdrop = new Backdrop(this, theme, { horizon: 232, alpha: 0.6 });
    this.ghostT = 0;

    this._buildHeader();
    this._buildStats();
    this.right = new Panel(this, theme, { x: 250, y: PANEL_Y, w: 216, h: PANEL_H, color: 'cyan', title: 'LEDGER', fillAlpha: 0.9 });
    this.board = new LeaderboardTable(this, theme, { x: 8, y: 22, w: 200, entries: null, parent: this.right });
    this._buildButtons();
    this._buildProgression();
    this.footer = new NeonText(this, theme, GAME_WIDTH / 2, GAME_HEIGHT - 4, 'SPACE / ENTER / A / TAP = RETRY SAME SEED', {
      color: 'text', anchor: 'center', vAnchor: 0.5,
    });
    this.footer.setAlpha(0.7);
    addScanlines(this);

    // Input is live immediately; nothing below waits on async work.
    this.input_ = new MenuInput(this, (a) => this._onAction(a));
    this._onPointer = (pointer, over) => {
      if (!this.entry && over.length === 0) this.retry();
    };
    this.input.on('pointerdown', this._onPointer);
    this.events.once('shutdown', () => {
      this.alive = false;
      this.input.off('pointerdown', this._onPointer);
      if (this.unbindBar) { this.unbindBar(); this.unbindBar = null; }
      if (this.pulse) { this.pulse.remove(); this.pulse = null; }
      this.resonance = null;
    });

    this._loadBoard();
  }

  _emptyRecord() {
    return { id: 'none', seed: this.registry.get(REG.SEED) || '', score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 1,
      maxAirtimeMs: 0, durationMs: 0, ledgerHash: '--------', dailyRuleId: '', cause: 'crash' };
  }

  // ------------------------------------------------------------ layout

  _buildHeader() {
    const theme = this.theme;
    const text = this.rec.cause === 'quit' ? 'RUN ENDED' : 'CRASHED';
    const y = 8;
    this.ghostA = new NeonText(this, theme, GAME_WIDTH / 2 - 2, y, text, { color: 'cyan', scale: 4, anchor: 'center', outline: 'none' });
    this.ghostB = new NeonText(this, theme, GAME_WIDTH / 2 + 2, y, text, { color: 'lime', scale: 4, anchor: 'center', outline: 'none' });
    this.ghostA.setAlpha(0.45);
    this.ghostB.setAlpha(0.45);
    this.title = new NeonText(this, theme, GAME_WIDTH / 2, y, text, { color: 'danger', scale: 4, anchor: 'center', outline: 'dark' });
    const seedLine = this.rec.dailyRuleId && this.rec.dailyRuleId !== 'none' ? `DAILY RULE  ${ruleLabel(this.rec.dailyRuleId)}` : '';
    this.rule = new NeonText(this, theme, GAME_WIDTH / 2, 42, seedLine, { color: 'amber', anchor: 'center', outline: 'none' });
  }

  _buildStats() {
    const theme = this.theme;
    const rec = this.rec;
    const p = (this.left = new Panel(this, theme, { x: 14, y: PANEL_Y, w: 226, h: PANEL_H, color: 'magenta', title: 'RUN REPORT', fillAlpha: 0.9 }));
    p.add(new NeonText(this, theme, 8, 21, 'SCORE', { color: 'text', outline: 'none' }).setAlpha(0.55));
    this.scoreText = new NeonText(this, theme, 8, 30, '0', { color: 'amber', scale: 3, outline: 'dark' });
    p.add(this.scoreText);
    const distPts = Math.floor(rec.distanceM || 0) * SCORING.pointsPerMeter;
    const trickCount = Object.values(rec.tricks || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const shards = Number(rec.shards) || 0;
    const near = Number(rec.nearMisses) || 0;
    const bonus = Number(rec.bonusPoints) || 0;
    // Shift resets are not stored in the record: whatever is left between the score and its parts is the reset penalty,
    // so the listed point rows always add up to the score (DISTANCE + TRICKS + BONUSES - RESET PENALTY).
    const penalty = Math.max(0, Math.round(distPts + (Number(rec.trickPoints) || 0) + bonus - (Number(rec.score) || 0)));
    const chase = this._chase(rec);
    this.chase = chase;
    // Report rows in display order with a priority (lower = kept first). At most MAX_ROWS fit above the ledger hash line,
    // so the lowest priorities are dropped rather than overlapping anything. Point rows (right column) come first.
    const cand = [
      { pri: 0, row: ['DISTANCE', `${fmtInt(rec.distanceM)} M`, `+${fmtInt(distPts)}`] },
      { pri: 1, row: ['TRICKS', `${fmtInt(trickCount)} DONE`, `+${fmtInt(rec.trickPoints)}`] },
      bonus > 0 && { pri: 2, row: ['BONUSES', '', `+${fmtInt(bonus)}`] },
      penalty > 0 && { pri: 3, row: ['RESET PENALTY', '', `-${fmtInt(penalty)}`], negative: true },
      { pri: 4, row: ['BEST COMBO', fmtMult(rec.bestCombo || 1), ''] },
      { pri: 5, row: ['BEST FLOW', fmtMult(Math.max(1, Number(rec.bestFlow) || 1)).replace(/(\.\d)0$/, '$1'), ''] },
      chase.streak > 0 && { pri: 6, row: ['DAILY STREAK', `${chase.streak} ${chase.streak === 1 ? 'DAY' : 'DAYS'}`, ''] },
      shards > 0 && { pri: 7, row: ['SHARDS', fmtInt(shards), ''] },
      near > 0 && { pri: 8, row: ['NEAR MISSES', fmtInt(near), ''] },
      { pri: 9, row: ['BEST AIR', `${fmtSec(rec.maxAirtimeMs)} S`, ''] },
      { pri: 10, row: ['RUN TIME', fmtClock(rec.durationMs), ''] },
    ].filter(Boolean);
    const keep = new Set(cand.slice().sort((a, b) => a.pri - b.pri).slice(0, MAX_ROWS));
    const rows = cand.filter((c) => keep.has(c));
    rows.forEach(({ row: [k, v, pts], negative }, i) => {
      const y = 56 + i * ROW_H;
      p.add(new NeonText(this, theme, 8, y, k, { color: 'text', outline: 'none' }).setAlpha(0.7));
      if (v) p.add(new NeonText(this, theme, 106, y, v, { color: 'cyan', outline: 'none' }));
      if (pts) p.add(new NeonText(this, theme, 218, y, pts, { color: negative ? 'danger' : 'lime', anchor: 'right', outline: 'none' }));
    });
    this._buildChaseLines(p, chase);
    p.add(new NeonText(this, theme, 8, 132, 'LEDGER HASH', { color: 'text', outline: 'none' }).setAlpha(0.7));
    p.add(new NeonText(this, theme, 106, 132, String(rec.ledgerHash || '--------').toUpperCase(), { color: 'magenta', outline: 'none' }));
    p.add(new NeonText(this, theme, 8, 144, 'SHARE SEED', { color: 'text', outline: 'none' }).setAlpha(0.7));
    this.seedText = new NeonText(this, theme, 106, 144, ellipsize(String(rec.seed || '-').toUpperCase(), 70), { color: 'lime', outline: 'none' });
    p.add(this.seedText);
    this.copyBtn = new Button(this, theme, {
      x: 182, y: 140, w: 36, h: 14, label: 'COPY', color: 'lime', onClick: () => this._copySeed(),
    });
    p.add(this.copyBtn);
    this.tweens.addCounter({
      from: 0, to: rec.score || 0, duration: Math.min(700, 200 + (rec.score || 0) * 0.2),
      onUpdate: (t) => this.scoreText.setText(fmtInt(t.getValue())),
      onComplete: () => this.scoreText.setText(fmtInt(rec.score)),
    });
  }

  /**
   * Chase stats for the finished run (all synchronous SaveStore scans, `excludeRunId` makes it correct whether or not the
   * run is already saved). Never throws.
   * @returns {{seedLine:string, seedKey:string, streak:number}}
   */
  _chase(rec) {
    const out = { seedLine: '', seedKey: 'amber', streak: 0 };
    const store = this.registry.get(REG.SAVE_STORE);
    if (!store || !rec || !rec.id || rec.id === 'none' || !rec.seed) return out;
    const score = Number(rec.score) || 0;
    const line = (label, prev) => {
      if (!prev || score > prev.bestScore) return { text: `NEW ${label} BEST`, key: 'lime' };
      return { text: `${label} BEST ${fmtInt(prev.bestScore)}`, key: 'amber' };
    };
    try {
      const prev = store.getSeedStats(rec.seed, { excludeRunId: rec.id });
      const l = line('SEED', prev);
      out.seedLine = l.text;
      out.seedKey = l.key;
    } catch (e) { /* cosmetic */ }
    try {
      const daily = DailyPatch.getDailyInfo(new Date(rec.startedAt || Date.now()));
      if (daily.seed === rec.seed) {
        // a daily seed: today's best is the seed's best, so it replaces the generic seed line
        const l = line("TODAY'S", store.getDailyStats(new Date(rec.startedAt || Date.now()), { excludeRunId: rec.id }));
        out.seedLine = l.text;
        out.seedKey = l.key;
        const st = store.getDailyStreak(Date.now());
        out.streak = (st && st.streak) || 0;
      }
    } catch (e) { /* cosmetic */ }
    return out;
  }

  _buildChaseLines(panel, chase) {
    if (!chase.seedLine) return;
    const t = new NeonText(this, this.theme, 218, 22, chase.seedLine, { color: chase.seedKey, anchor: 'right', outline: 'none' });
    panel.add(t);
    if (chase.seedKey === 'lime') this.tweens.add({ targets: t, alpha: { from: 1, to: 0.5 }, duration: 320, yoyo: true, repeat: -1 });
  }

  // ------------------------------------------------------------ progression (W1)

  /**
   * One Resonance row under the buttons: XP earned in this run, the level bar, and on a level-up the
   * "SYNC LEVEL n" line plus what unlocked. Cosmetic only — Retry remains frame-one responsive and
   * cancels the count-up tween. Never throws, and renders nothing when no awards were published.
   */
  _buildProgression() {
    const theme = this.theme;
    const awards = this.registry.get(REG.LAST_AWARDS) || null;
    if (!awards || !awards.xp || !awards.xp.total) return;
    const y = 250;
    const xp = awards.xp;
    const prog = awards.progress || { level: 1, ratio: 0, xpToNext: 0 };
    const label = awards.leveledTo ? `SYNC LEVEL ${awards.leveledTo}` : `SYNC LEVEL ${prog.level}`;
    this.xpText = new NeonText(this, theme, 14, y, `+${fmtInt(xp.total)} XP`, { color: 'amber', outline: 'none' });
    this.levelText = new NeonText(this, theme, 96, y, label, { color: awards.leveledTo ? 'lime' : 'cyan', outline: 'none' });
    this.rewardsText = new NeonText(this, theme, GAME_WIDTH - 14, y, this._rewardsLine(awards), {
      color: awards.leveledTo ? 'lime' : 'text', anchor: 'right', outline: 'none',
    });
    if (!awards.leveledTo) this.rewardsText.setAlpha(0.7);

    // Resonance bar between the XP figure and the rewards line; fills with the level ratio.
    const barX = 96, barY = y + 10, barW = 150, barH = 4;
    this.resonance = this.add.graphics();
    const paint = (pal) => {
      if (!this.resonance) return;
      this.resonance.clear();
      this.resonance.fillStyle(pal.bg, 1);
      this.resonance.fillRect(barX, barY, barW, barH);
      const w = Math.max(0, Math.min(1, prog.ratio || 0));
      this.resonance.fillStyle(awards.leveledTo ? pal.amber : pal.lime, 1);
      this.resonance.fillRect(barX, barY, Math.round(barW * w), barH);
      this.resonance.lineStyle(1, pal[awards.leveledTo ? 'amber' : 'cyan'], 0.6);
      this.resonance.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
    };
    paint(theme.pal);
    this.unbindBar = theme.bind(paint);

    // Crisp bar start: brief pulse on a level-up, but nothing blocks input and Retry cancels it.
    if (awards.leveledTo) {
      this.pulse = this.tweens.addCounter({
        from: 0, to: 1, duration: 420, yoyo: false,
        onUpdate: (t) => {
          if (this.rewardsText) this.rewardsText.setAlpha(0.55 + 0.45 * Math.abs(1 - 2 * t.getValue()));
        },
      });
    }
  }

  /** @returns {string} short "what unlocked" line, or the "next level" hint. */
  _rewardsLine(awards) {
    if (awards.leveledTo && awards.rewards) {
      const bits = [];
      if (awards.rewards.title) bits.push(String(awards.rewards.title).toUpperCase());
      if (awards.rewards.cosmetic) bits.push(String(awards.rewards.cosmetic).toUpperCase());
      if (awards.rewards.biome) bits.push('SIGNATURE LOCKED - COMING ONLINE');
      if (bits.length) return bits.join('  ·  ');
    }
    const toNext = awards.progress ? awards.progress.xpToNext : 0;
    if (toNext > 0) return `${fmtInt(toNext)} XP TO NEXT`;
    return 'MAX SYNC';
  }

  _buildButtons() {
    const theme = this.theme;
    const y = 220;
    const defs = [
      { w: 150, label: 'RETRY', hint: 'SPACE / ENTER / A', color: 'lime', fn: () => this.retry() },
      { w: 130, label: 'NEW SEED', hint: 'N / X', color: 'cyan', fn: () => this.newSeed() },
      { w: 110, label: 'TITLE', hint: 'ESC / B', color: 'magenta', fn: () => this.toTitle() },
    ];
    let x = Math.round((GAME_WIDTH - (150 + 130 + 110 + 24)) / 2);
    this.buttons = defs.map((d) => {
      const b = new Button(this, theme, { x, y, w: d.w, h: 24, label: d.label, hint: d.hint, color: d.color, onClick: d.fn });
      x += d.w + 12;
      return b;
    });
  }

  // ------------------------------------------------------------ leaderboard / entry

  _loadBoard() {
    const rec = this.rec;
    const store = this.registry.get(REG.SAVE_STORE);
    const safe = (fn, fallback) => {
      try {
        return Promise.resolve(fn()).catch(() => fallback);
      } catch (e) {
        return Promise.resolve(fallback);
      }
    };
    this._loadBest(store, rec, safe);
    Promise.all([
      safe(() => store.qualifiesForTop10(rec.score), false),
      safe(() => store.getLeaderboard(10), []),
    ]).then(([qualifies, rows]) => {
      if (!this.alive || this.leaving) return;
      this.rows = Array.isArray(rows) ? rows : [];
      const already = this.rows.some((r) => r.id === rec.id);
      const worthy = this.rows.length >= 3 || (rec.score || 0) >= 200;
      if (qualifies && worthy && !already && (rec.score || 0) > 0 && rec.cause !== 'quit') this._showEntry();
      else this._showBoard(already ? rec.id : undefined);
    });
  }

  /** Compare this run with the device best (all stored runs except this one). Cosmetic, async, never blocks. */
  _loadBest(store, rec, safe) {
    safe(() => store.getRecentRuns(1000), []).then((runs) => {
      if (!this.alive || !Array.isArray(runs) || rec.cause === 'quit' && !(rec.score > 0)) return;
      const others = runs.filter((r) => r && r.id !== rec.id);
      if (!others.length) return;
      const bestM = Math.max(...others.map((r) => r.distanceM || 0));
      const bestS = Math.max(...others.map((r) => r.score || 0));
      const m = rec.distanceM || 0;
      let l1;
      let l2;
      let key;
      if (m > bestM || (rec.score || 0) > bestS) {
        // the chase line above already says NEW SEED / TODAY'S BEST (a score best): a second "score best" line is noise
        if (m <= bestM && this.chase && this.chase.seedKey === 'lime') return;
        // name the metric: the chase line above (seed / today's best) is a SCORE best, this one compares with the device
        l1 = m > bestM ? 'DISTANCE BEST!' : 'SCORE BEST!';
        l2 = m > bestM ? `PREV ${fmtInt(bestM)} M` : `PREV ${fmtInt(bestS)} PTS`;
        key = 'lime';
      } else {
        l1 = `${fmtInt(bestM - m)} M SHORT OF`;
        l2 = 'DISTANCE BEST';
        key = 'amber';
      }
      const a = new NeonText(this, this.theme, 218, 32, l1, { color: key, anchor: 'right', outline: 'none' });
      const b = new NeonText(this, this.theme, 218, 42, l2, { color: 'text', anchor: 'right', outline: 'none' });
      b.setAlpha(0.7);
      this.left.add([a, b]);
      if (key === 'lime') {
        this.tweens.add({ targets: a, alpha: { from: 1, to: 0.4 }, duration: 260, yoyo: true, repeat: -1 });
        uiSfx(this, 'newBest');
      }
    });
  }

  _showEntry() {
    const theme = this.theme;
    this.board.setVisible(false);
    this.right.setColorKey('lime').setTitle('NEW TOP 10!');
    const last = (this.registry.get(REG.SETTINGS) || {}).lastInitials || '';
    const y0 = 22;
    this.entryGroup = [];
    const t1 = new NeonText(this, theme, 108, y0, 'ENTER YOUR INITIALS', { color: 'lime', anchor: 'center', outline: 'none' });
    this.right.add(t1);
    this.entry = new InitialsEntry(this, theme, {
      x: 0, y: y0 + 6, w: 216, length: INITIALS_LENGTH, initial: last, color: 'lime', onSubmit: (v) => this.saveEntry(v),
    });
    this.right.add(this.entry);
    const hint = new NeonText(this, theme, 108, 106, 'TYPE / ARROWS / TAP  -  ENTER SAVES', { color: 'text', anchor: 'center', outline: 'none' });
    const hint2 = new NeonText(this, theme, 108, 118, 'SPACE = SAVE + RETRY   ESC = SKIP', { color: 'text', anchor: 'center', outline: 'none' });
    hint.setAlpha(0.6);
    hint2.setAlpha(0.6);
    this.right.add([hint, hint2]);
    this.entryGroup = [t1, hint, hint2];
    this.input_.rawKeyHandler = (e) => this._rawKey(e);
    this.footer.setText('TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY');
    this._retryHint('SPACE = SAVE + RETRY');
    uiSfx(this, 'combo');
  }

  _rawKey(e) {
    if (e.key === ' ') {
      if (!e.repeat) this.retry();
      return true;
    }
    if (e.key === 'Enter') {
      if (!e.repeat) this.entry.submit();
      return true;
    }
    if (e.key === 'Escape') {
      if (!e.repeat) this.skipEntry();
      return true;
    }
    const arrow = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (arrow) {
      this.entry.handleAction(arrow);
      return true;
    }
    this.entry.handleKey(e);
    return true; // swallow everything else while typing
  }

  _leaveEntry() {
    if (this.entry) this.entry.destroy();
    this.entry = null;
    for (const t of this.entryGroup || []) t.destroy();
    this.entryGroup = [];
    this.input_.rawKeyHandler = null;
    this.footer.setText('SPACE / ENTER / A / TAP = RETRY SAME SEED');
    this._retryHint('SPACE / ENTER / A');
  }

  _retryHint(text) {
    const b = this.buttons && this.buttons[0];
    if (b && b.hintText) b.hintText.setText(text);
  }

  skipEntry() {
    if (!this.entry) return;
    this._leaveEntry();
    this._showBoard();
  }

  /**
   * Persist initials. Never throws; resolves true on success.
   * @param {string} initials
   * @returns {Promise<boolean>}
   */
  async _persist(initials) {
    if (this.saved) return true;
    const store = this.registry.get(REG.SAVE_STORE);
    try {
      await store.setInitials(this.rec.id, initials);
      this.saved = true;
      this.rec.initials = initials;
      updateSetting(this.game, 'lastInitials', initials);
      return true;
    } catch (e) {
      console.warn('[BitstreamBluffs] could not save initials', e);
      return false;
    }
  }

  async saveEntry(initials) {
    if (!this.entry || this.leaving) return;
    this._leaveEntry();
    this.right.setColorKey('cyan').setTitle('LEDGER');
    const ok = await this._persist(initials);
    if (!this.alive || this.leaving) return;
    let rows = this.rows;
    if (ok) {
      try {
        rows = (await this.registry.get(REG.SAVE_STORE).getLeaderboard(10)) || [];
      } catch (e) {
        rows = this.rows;
      }
      if (!rows.some((r) => r.id === this.rec.id)) {
        rows = [...rows, { ...this.rec, initials }].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
      }
      uiSfx(this, 'powerup');
    } else {
      uiSfx(this, 'uiBack');
    }
    if (!this.alive || this.leaving) return;
    this.rows = rows;
    this._showBoard(ok ? this.rec.id : undefined);
  }

  _showBoard(highlightId) {
    this.board.setVisible(true);
    this.board.setEntries(this.rows, highlightId);
    this.right.setTitle(highlightId ? 'LEDGER // YOU ARE ON THE BOARD' : 'LEDGER // TOP 10');
  }

  // ------------------------------------------------------------ actions

  _onAction(action) {
    if (this.leaving) return;
    if (this.entry) {
      // gamepad / touch routed actions while entering initials
      if (action === 'cancel' && !this.entry.handleAction('cancel')) this.skipEntry();
      else if (action !== 'cancel') this.entry.handleAction(action);
      return;
    }
    if (action === 'confirm') this.retry();
    else if (action === 'alt') this.newSeed();
    else if (action === 'cancel') this.toTitle();
  }

  _commitPending() {
    // fire-and-forget: leaving must never wait on storage
    if (this.entry && !this.saved) this._persist(this.entry.getValue());
  }

  /** Instant retry with the same seed. @returns {void} */
  retry() {
    if (this.leaving) return;
    this.leaving = true;
    // W1: the XP award is already committed (the service credits synchronously on RUN_END), so this
    // run cannot be banked twice by retrying. Cancel the cosmetic pulse so retry stays frame-one crisp.
    if (this.pulse) { this.pulse.remove(); this.pulse = null; }
    this._commitPending();
    if (this.rec.seed) this.registry.set(REG.SEED, this.rec.seed);
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    this.scene.start(SCENES.RUN);
  }

  /** @returns {void} */
  newSeed() {
    if (this.leaving) return;
    this.leaving = true;
    this._commitPending();
    this.registry.set(REG.SEED, randomSeed());
    uiSfx(this, 'uiSelect');
    this.scene.start(SCENES.RUN);
  }

  /** @returns {void} */
  toTitle() {
    if (this.leaving) return;
    this.leaving = true;
    this._commitPending();
    uiSfx(this, 'uiBack');
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  async _copySeed() {
    const ok = await copyText(String(this.rec.seed || ''));
    if (!this.alive) return;
    this.copyBtn.setLabel(ok ? 'OK!' : 'NO');
    this.seedText.setColorKey(ok ? 'amber' : 'danger');
    this.time.delayedCall(1500, () => {
      if (!this.alive) return;
      this.copyBtn.setLabel('COPY');
      this.seedText.setColorKey('lime');
    });
    if (!ok) this.footer.setText(`CLIPBOARD BLOCKED - SEED: ${String(this.rec.seed).toUpperCase()}`);
  }

  update(time, delta) {
    this.backdrop.update(time);
    if (this.board && this.board.visible) this.board.tick(delta);
    // glitchy header
    this.ghostT -= delta;
    if (this.ghostT <= 0) {
      const j = Math.random() < 0.25;
      this.ghostA.setX(GAME_WIDTH / 2 - (j ? 5 : 2));
      this.ghostB.setX(GAME_WIDTH / 2 + (j ? 5 : 2));
      this.title.setX(GAME_WIDTH / 2 + (j ? Phaser.Math.Between(-2, 2) : 0));
      this.ghostT = j ? 90 : 700;
    }
  }
}
