/**
 * OWNER: UI engineer.
 * Started by RunScene (`scene.start(SCENES.GAME_OVER)`) after RUN_END. Reads the RunRecord from registry REG.LAST_RECORD
 * (RunScene already called saveStore.saveRun). Shows the score breakdown, ledger hash, share-seed (copyable) and the
 * daily rule. If the run qualifies for the Top-10 (and scored > 0) an initials entry (INITIALS_LENGTH slots, configurable)
 * saves via saveStore.setInitials + updateSetting('lastInitials'); then the leaderboard is shown with the new entry
 * highlighted.
 *
 * INSTANT RETRY: Space / Enter / gamepad A / RB / tap restarts with the SAME seed immediately - input is live from the
 * very first frame and never waits for animations or for the (async) leaderboard queries. While the initials entry is
 * open: Enter saves, Space (or pad RB) saves and retries at once, Esc skips. N / X = new seed. Esc and pad B (both
 * MenuInput 'cancel') = title. Keyboard B and pad LB / LT (MenuInput 'shop') = Shard Shop, when anything is affordable.
 * In the open shop (Marvin decision 7): Enter / pad A buy or equip the highlighted row once the shop is armed, Space /
 * pad RB (MenuInput 'retry') retry, Esc / pad B / B / LB close it, N / X / Y start a new seed.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT, SCORING } from '../constants.js';
import { updateSetting } from '../services.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { Theme } from '../ui/Theme.js';
import { NeonText } from '../ui/Neon.js';
import {
  columnRows, GAMEOVER_MISSIONS_Y, GAMEOVER_ROW_H, GAMEOVER_BOARD_ROWS, GAMEOVER_BOARD_ROW_H,
  GAMEOVER_MISSIONS_RULE_Y, entryLayout,
} from '../ui/MissionsLayout.js';
import { ellipsize, measureText } from '../ui/PixelFont.js';
// Whether a boosted run may rank is Ranking.js's decision alone (W4's single-helper rule), so this scene
// asks it instead of testing rec.modded itself.
import { boardsModded, rankableOnly, isOfficialDaily } from '../systems/Ranking.js';
import { Panel } from '../ui/Panel.js';
import { Button } from '../ui/Button.js';
import { MenuInput } from '../ui/MenuInput.js';
import { Backdrop } from '../ui/Backdrop.js';
import { isReducedMotion, tweenProgress, transitionIn, Ease, lerp, motionMs } from '../ui/Motion.js';
import { glowRectPx } from '../ui/Neon.js';
import { addScanlines } from '../ui/Scanlines.js';
import { InitialsEntry } from '../ui/InitialsEntry.js';
import { LeaderboardTable, ruleLabel } from '../ui/LeaderboardTable.js';
import { copyText } from '../ui/Clipboard.js';
import { fmtInt, fmtClock, fmtMult, fmtSec, randomSeed, INITIALS_LENGTH, shareableSeed } from '../ui/Format.js';
import { toastLayout } from '../ui/AchievementsLayout.js';
import { enabledBiomeMask } from '../systems/ProfileStore.js';
import { canAffordAnything, shopState } from '../systems/ShopPrompt.js';
import { ShopView } from '../ui/Views.js';
import { GhostFavoritesView } from '../ui/GhostFavoritesView.js';
import { CemeteryMontageView } from '../ui/CemeteryMontageView.js';
import { sanitizeMontageStyle } from '../systems/ghost/montageSettings.js';
import { ATTEMPT_HISTORY_KEY } from '../systems/ghost/attemptHistoryService.js';
import { uiSfx } from '../ui/Sound.js';
import { JukeboxHUD } from '../ui/JukeboxHUD.js';
import { gameOverLine } from '../systems/CrashReport.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';

const PANEL_Y = 54;
const PANEL_H = 160;
/** RUN REPORT rows start at panel y 56 and must end above the ledger-hash line (y 132: 8 rows end at y 126). */
const ROW_H = 9;
const MAX_ROWS = 8;
/**
 * W4.1: how long Game Over waits before deciding to open the shop by itself.
 *
 * Long enough for the score count-up and the awards line to settle so the popup does not interrupt the
 * number the player is watching, short enough that it does not feel like a separate event. Any input at
 * all before it fires cancels it — see `_cancelShopAutoprompt`.
 */
const SHOP_PROMPT_MS = 1200;
// After initials entry closes: a beat so the board appearing and the shop appearing are not one frame.
const SHOP_AFTER_ENTRY_MS = 500;
/**
 * The keys the footer hint advertises. Both must match MenuInput's `shop` action: keyboard B, and pad LB
 * (LT works too). Naming only "B" misled pad players, for whom B is cancel = Title (audit U6b).
 */
const SHOP_HINT = 'SHOP: B / LB';
/**
 * Marvin decision 7: how long an UNREQUESTED (autoprompt) shop waits before Enter / pad A buy in it.
 *
 * The popup appears only after SHOP_PROMPT_MS with no input at all, so the risky press is one the player
 * started before they saw the panel: a retry already on its way. Simple visual reaction time is about
 * 200-300 ms and a choice reaction (see a new panel, decide to act on it) about 400-500 ms, so any confirm
 * inside 500 ms of the popup was aimed at Game Over, not at the shop, and keeps today's close-and-retry.
 * Moving the cursor arms the shop at once (the player chose that row), and a shop opened with B / LB is
 * armed from its first frame, so a deliberate buyer never waits for this.
 */
export const SHOP_ARM_MS = 500;
/** The footer while an armed shop is open; replaces the retry line, which is no longer true for Enter. */
export const SHOP_FOOTER = 'ENTER / A = BUY   SPACE / RB = RETRY   ESC / B = BACK';

/** Display name of a biome, upper-cased: from the loaded content when a registry is given, else from the id. */
function biomeLabel(id, registry) {
  let name = '';
  try {
    const biomes = (registry && typeof registry.get === 'function' && (registry.get(REG.CONTENT) || {}).biomes) || {};
    const def = biomes[id] || Object.values(biomes).find((b) => b && b.id === id);
    name = def && def.name ? String(def.name) : '';
  } catch (e) { /* fall back to the id */ }
  if (!name) name = String(id || '').replace(/[-_]/g, ' ');
  return name.toUpperCase();
}

/**
 * What a level-up unlocked in biomes: "SIGNATURE ONLINE: <BIOME>", or "SIGNATURES ONLINE: A, B" for a
 * multi-level jump. All 11 biomes ship, so the old "SIGNATURE LOCKED - COMING ONLINE" was false (audit GO-1 /
 * U6a). When several names cannot fit `maxPx`, it says how many came online instead of cutting a name.
 * @param {string[]} ids biome ids
 * @param {{get:function(string):*}} [registry]
 * @param {number} [maxPx]
 * @returns {string} '' when there are none
 */
function biomeOnlineLine(ids, registry, maxPx = 280) {
  const names = ids.map((id) => biomeLabel(id, registry));
  if (!names.length) return '';
  if (names.length === 1) return `SIGNATURE ONLINE: ${names[0]}`;
  const all = `SIGNATURES ONLINE: ${names.join(', ')}`;
  return measureText(all) <= maxPx ? all : `${names.length} SIGNATURES ONLINE`;
}

/**
 * `head / tail` within maxPx, cutting only the tail (and dropping it when too little room is left for a
 * readable piece). The head is the part that must never lose its words.
 * @param {string} head @param {string} tail @param {number} maxPx
 * @returns {string}
 */
function withTail(head, tail, maxPx) {
  if (!tail) return ellipsize(head, maxPx);
  const full = `${head} / ${tail}`;
  if (measureText(full) <= maxPx) return full;
  // measureText drops the trailing 1px gap of each string, so the joined line is 1px wider than the parts' sum.
  const room = maxPx - measureText(`${head} / `) - 1;
  return room >= 40 ? `${head} / ${ellipsize(tail, room)}` : ellipsize(head, maxPx);
}

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
    this.board = new LeaderboardTable(this, theme, {
      x: 8, y: 22, w: 200, entries: null, rows: GAMEOVER_BOARD_ROWS,
      rowH: GAMEOVER_BOARD_ROW_H, parent: this.right,
    });
    // Must come after this.right exists: the mission block lives in the LEDGER panel, and calling it
    // from _buildStats() drew nothing at all because the panel was not constructed yet.
    this._buildMissions();
    this._buildButtons();
    this._buildMontageButton();
    this._buildProgression();
    this._buildAchievementToast();
    this.footer = new NeonText(this, theme, GAME_WIDTH / 2, GAME_HEIGHT - 5, 'SPACE / ENTER / A / TAP = RETRY SAME SEED', {
      color: 'text', anchor: 'center', vAnchor: 0.5,
    });
    this.footer.setAlpha(0.7);
    addScanlines(this);
    // End screen permits a soundtrack audition without starting a new run.
    this.jukebox=new JukeboxHUD(this,theme,{x:335,y:4});

    // Input is live immediately; nothing below waits on async work.
    // retryAction: Space and pad RB also send 'retry', which retries even from inside the shop (decision 7).
    this.input_ = new MenuInput(this, (a) => this._onAction(a), { retryAction: true });
    this._onPointer = (pointer, over) => {
      // W4.1: a tap is input too, so it also cancels a pending auto-open. While the shop is up the tap
      // belongs to the shop's own rows, not to retry.
      if (this.shopOpen || this.ghostView) return;
      this.skipReveal();
      // A tap on the jukebox or its open queue is NOT a retry, even if
      // Phaser's over[] misses the translucent queue's backing Zone.
      if (this.jukebox?.ownsPointer(pointer)) return;
      this._cancelShopAutoprompt();
      if (!this.entry && over.length === 0) this.retry();
    };
    this.input.on('pointerdown', this._onPointer);
    this.events.once('shutdown', () => {
      this.jukebox?.destroy();this.jukebox=null;
      this.alive = false;
      this.input.off('pointerdown', this._onPointer);
      // W4.1: no timer or view may outlive the scene, or a popup fires into a scene that is gone.
      if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
      if (this.shopArmTimer) {
        try { this.shopArmTimer.remove(false); } catch (e) { /* already gone */ }
        this.shopArmTimer = null;
      }
      if (this.shopView) {
        try { this.shopView.destroy(); } catch (e) { /* already torn down */ }
        this.shopView = null;
      }
      if (this.shopDim) {
        try { this.shopDim.destroy(); } catch (e) { /* already torn down */ }
        this.shopDim = null;
      }
      this.shopOpen = false;
      this.shopHint = null;
      if (this.ghostView || this.ghostDim) this._closeGhosts();
      if (this.unbindBar) { this.unbindBar(); this.unbindBar = null; }
      if (this.pulse) { this.pulse.remove(); this.pulse = null; }
      if (this.toastFade) { this.toastFade.remove(); this.toastFade = null; }
      this.resonance = null;
    });

    this._loadBoard();
    // W4.1: last, so the footer and buttons already exist when the hint is measured against them.
    this._buildShopAccess();
    this._startReveal();
  }

  _emptyRecord() {
    return { id: 'none', seed: this.registry.get(REG.SEED) || '', score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 1,
      maxAirtimeMs: 0, durationMs: 0, ledgerHash: '--------', dailyRuleId: '', cause: 'crash' };
  }

  // ------------------------------------------------------------ layout

  _buildHeader() {
    const theme = this.theme;
    const text = this.rec.cause === 'quit' ? 'RUN ENDED' : 'CRASHED';
    // Decision 2: a run on a daily seed says whether it was the official Daily or a practice run of a date.
    const dailyLabel = this.rec.dailyMode==='draft'&&isOfficialDaily(this.rec)
      ? 'DAILY DRAFT' : DailyPatch.dailyRunLabel(this.rec.seed, isOfficialDaily(this.rec));
    const hasRule = this.rec.dailyRuleId && this.rec.dailyRuleId !== 'none';
    const seedLine = dailyLabel
      ? `${dailyLabel}${hasRule ? `  ${ruleLabel(this.rec.dailyRuleId)}` : ''}`
      : hasRule ? `DAILY RULE  ${ruleLabel(this.rec.dailyRuleId)}` : '';
    // Readable Chaos phase 3: who killed this run, and how the hop was timed (REG.LAST_CRASH, this run's id only).
    // With a rule line as well, the title drops to scale 3 so both lines fit above the panels.
    const crashLine = gameOverLine(this.registry.get(REG.LAST_CRASH), this.rec);
    const both = !!crashLine && !!seedLine;
    const ts = both ? 3 : 4;
    const y = 8;
    this.ghostA = new NeonText(this, theme, GAME_WIDTH / 2 - 2, y, text, { color: 'cyan', scale: ts, anchor: 'center', outline: 'none' });
    this.ghostB = new NeonText(this, theme, GAME_WIDTH / 2 + 2, y, text, { color: 'lime', scale: ts, anchor: 'center', outline: 'none' });
    this.ghostA.setAlpha(0.45);
    this.ghostB.setAlpha(0.45);
    this.title = new NeonText(this, theme, GAME_WIDTH / 2, y, text, { color: 'danger', scale: ts, anchor: 'center', outline: 'dark' });
    this.rule = new NeonText(this, theme, GAME_WIDTH / 2, both ? 33 : 42, seedLine, { color: 'amber', anchor: 'center', outline: 'none' });
    this.crashLine = crashLine
      ? new NeonText(this, theme, GAME_WIDTH / 2, both ? 43 : 42, crashLine, { color: 'danger', anchor: 'center', outline: 'dark' })
      : null;
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
    this.tallies = [];
    this.statRows = [];
    rows.forEach(({ row: [k, v, pts], negative }, i) => {
      const y = 56 + i * ROW_H;
      const group = [];
      const kt = new NeonText(this, theme, 8, y, k, { color: 'text', outline: 'none' }).setAlpha(0.7);
      p.add(kt);
      group.push(kt);
      if (v) {
        const vt = new NeonText(this, theme, 106, y, v, { color: 'cyan', outline: 'none' });
        p.add(vt);
        group.push(vt);
        // DISTANCE and TRICKS tally up with the score; the final text is what is built here.
        if (k === 'DISTANCE') this.tallies.push({ obj: vt, to: Math.floor(Number(rec.distanceM) || 0), fmt: (n) => `${fmtInt(n)} M` });
        else if (k === 'TRICKS') this.tallies.push({ obj: vt, to: trickCount, fmt: (n) => `${fmtInt(n)} DONE` });
      }
      if (pts) {
        const pt = new NeonText(this, theme, 218, y, pts, { color: negative ? 'danger' : 'lime', anchor: 'right', outline: 'none' });
        p.add(pt);
        group.push(pt);
        const sign = pts.charAt(0);
        const n = Number(String(pts).replace(/[^0-9]/g, '')) || 0;
        this.tallies.push({ obj: pt, to: n, fmt: (m) => `${sign}${fmtInt(m)}` });
      }
      this.statRows.push(group);
    });
    this._buildChaseLines(p, chase);
    p.add(new NeonText(this, theme, 8, 132, 'LEDGER HASH', { color: 'text', outline: 'none' }).setAlpha(0.7));
    p.add(new NeonText(this, theme, 106, 132, String(rec.ledgerHash || '--------').toUpperCase(), { color: 'magenta', outline: 'none' }));
    p.add(new NeonText(this, theme, 8, 144, 'SHARE SEED', { color: 'text', outline: 'none' }).setAlpha(0.7));
    // The mask is part of the run's identity: replaying a mask-31 run on the bare seed would drop the
    // player into a different world, so the shareable seed carries the same @mask suffix the entry
    // field accepts (W3 spec). Mask 0 stays suffix-free so every existing seed string is unchanged.
    const seedShown = shareableSeed(rec);
    this.seedText = new NeonText(this, theme, 106, 144, ellipsize(seedShown.toUpperCase(), 70), { color: 'lime', outline: 'none' });
    p.add(this.seedText);
    this.copyBtn = new Button(this, theme, {
      x: 182, y: 140, w: 36, h: 14, label: 'COPY', color: 'lime', onClick: () => this._copySeed(),
    });
    p.add(this.copyBtn);
    // Issue #56: pin this run as a ghost favorite. In the panel's title row (right of the tab), the only
    // free band of a full report; shown only when this run actually recorded a ghost tape.
    const tape = this.registry.get(REG.LAST_GHOST_TAPE);
    if (tape && tape.runId === rec.id && this.registry.get(REG.GHOSTS)) {
      this.ghostBtn = new Button(this, theme, { x: 156, y: 1, w: 62, h: 12, label: 'GHOST FAV', color: 'magenta', onClick: () => this._openGhosts() });
      p.add(this.ghostBtn);
    }
    // The score is built at its final value; _startReveal() counts it up from zero (and shows the final
    // value at once under reduced motion or when the player skips).
    this.scoreText.setText(fmtInt(rec.score));
  }

  /**
   * W2: the three missions with their standing progress.
   *
   * They live in the LEDGER panel's unused bottom band (local y 104..160), NOT in RUN REPORT: that
   * panel is full to its floor (8 report rows to local 128, then the ledger hash at 132, seed at 144
   * and the COPY button ending at 154, with the panel floor at 160). Luna's round-2 audit caught the
   * first attempt doing exactly that — it hung the rows past the panel, through the retry buttons at
   * screen y 220..244 and the XP line at 246. The board ends at local 103, so this band is the only
   * one on the screen that is genuinely empty; the geometry is asserted in
   * tests/src/missionslayout.test.js against the real panel and button bands.
   */
  _buildMissions() {
    try {
      const view = this.registry.get(REG.MISSIONS);
      // What this run actually earned, not what was handed out for the next one. The panel previously
      // drew only the freshly dealt actives, so a run that completed a mission and paid 60 XP showed
      // the player three missions they had never seen and no word about the one they had just cleared
      // (CC Friday, W2). Completed comes from the same roll the awards were credited from.
      const completed = (view && Array.isArray(view.completed)) ? view.completed : [];
      const rows = (view && view.active) || [];
      if (!rows.length && !completed.length) return;
      // No soft `if (!p) return` here: that is what let the block silently draw nothing when it ran
      // before the LEDGER panel existed. A missing panel is a construction-order bug and must be loud.
      const p = this.right;
      if (!p) throw new Error('GameOverScene._buildMissions: LEDGER panel missing — call after this.right exists');
      // The band fits exactly three rows and there is no spare pixel, so the rows are repurposed
      // rather than a line being appended: completed missions first (with their payout), then the
      // fresh actives for context. A mission cannot be both, so the two lists never double up.
      // Payout FIRST, title after: the row is 166 px of glyphs and "Grab 15 shards in a run  +60 XP +4"
      // measures 172, so ellipsizing from the end silently ate the shard reward - the exact number the
      // block exists to show. Leading with the payout means a long title is what gets clipped.
      const doneRows = completed.slice(0, 3).map((c) => ({
        label: `${c.xp ? `+${c.xp} XP ` : ''}${c.shards ? `+${c.shards} ` : ''}${c.title}`,
        color: 'lime',
        done: true,
        // A completed mission has nothing left to progress toward; the bar would be a lie at 0 or a
        // tautology at 100, so it is omitted entirely.
        fraction: null,
      }));
      const activeRows = rows.slice(0, Math.max(0, 3 - doneRows.length)).map((row) => ({
        label: ellipsize(row.title, 200 - 30 - 4),
        color: row.done ? 'lime' : 'text',
        done: Boolean(row.done),
        fraction: Math.max(0, Math.min(1, row.fraction || 0)),
      }));
      const listed = doneRows.concat(activeRows);
      const geom = columnRows({ x: 8, y: GAMEOVER_MISSIONS_Y, w: 200, count: listed.length, rowH: GAMEOVER_ROW_H, barH: 2 });
      // A separator rule instead of a "MISSIONS" heading: with ten truthful leaderboard rows there is
      // no vertical room for a heading line, and a rule marks the group without claiming a row of its
      // own. The progress bars under each label carry the rest of the grouping.
      const rule = this.add.graphics();
      rule.fillStyle(this.theme.color('cyan'), 0.35);
      rule.fillRect(8, GAMEOVER_MISSIONS_RULE_Y, 200, 1);
      p.add(rule);
      listed.forEach((row, i) => {
        const r = geom.rows[i];
        const b = geom.bars[i];
        if (!r || !b) return;
        const label = new NeonText(this, this.theme, r.x, r.y, ellipsize(row.label, geom.textW), {
          color: row.color, outline: 'none',
        });
        label.setAlpha(0.9);
        p.add(label);
        if (row.fraction === null) return; // completed: no bar (see doneRows)
        const g = this.add.graphics();
        g.fillStyle(0x1a2b3a, 1);
        g.fillRect(b.x, b.y, b.w, b.h);
        const frac = Math.max(0, Math.min(1, row.fraction || 0));
        if (frac > 0) {
          g.fillStyle(row.done ? 0x9cff57 : this.theme.color('cyan'), 1);
          g.fillRect(b.x, b.y, Math.max(1, Math.round(b.w * frac)), b.h);
        }
        p.add(g);
      });
    } catch (e) { /* cosmetic */ }
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
    // An unranked boosted run has no seed best, no daily best and no streak to announce: none of those
    // tables will contain it. Saying nothing is the honest answer; the panel says MODDED - UNRANKED.
    if (boardsModded(rec)) { out.unranked = true; return out; }
    const score = Number(rec.score) || 0;
    const line = (label, prev) => {
      if (!prev || score > prev.bestScore) return { text: `NEW ${label} BEST`, key: 'lime' };
      return { text: `${label} BEST ${fmtInt(prev.bestScore)}`, key: 'amber' };
    };
    try {
      // D6: seed-best compares only within the same biome mask. Without the scope, a mask-31 run
      // would be judged against mask-0 runs and report a "NEW SEED BEST" it never set.
      const prev = store.getSeedStats(rec.seed, { excludeRunId: rec.id, biomeMask: Number(rec.biomeMask) || 0 });
      const l = line('SEED', prev);
      out.seedLine = l.text;
      out.seedKey = l.key;
    } catch (e) { /* cosmetic */ }
    try {
      // Decisions 1/2: only the OFFICIAL Daily is judged against TODAY'S BEST and shows the streak. A
      // practice run (a typed daily seed) keeps the ordinary seed-best line above, within its own mask.
      const daily = DailyPatch.getDailyInfo(new Date(rec.startedAt || Date.now()));
      if (daily.seed === rec.seed && isOfficialDaily(rec)) {
        // the official Daily: today's best replaces the generic seed line
        const draft=rec.dailyMode==='draft';
        const l = line(draft?'DRAFT':"TODAY'S", store.getDailyStats(
          new Date(rec.startedAt || Date.now()),{excludeRunId:rec.id,mode:draft?'draft':'classic'}));
        out.seedLine = l.text;
        out.seedKey = l.key;
        const st = store.getDailyStreak(Date.now());
        out.streak = (st && st.streak) || 0;
      }
    } catch (e) { /* cosmetic */ }
    return out;
  }

  _buildChaseLines(panel, chase) {
    if (chase.unranked) {
      // Occupy the same slot the seed-best line would, so the player is told why there is no best here
      // rather than being left to infer it from a missing line.
      const u = new NeonText(this, this.theme, 218, 22, 'MODDED - UNRANKED', { color: 'amber', anchor: 'right', outline: 'none' });
      panel.add(u);
      return;
    }
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
    // Keep the 4px bar above the footer's measured ink bounds at the 480x270 virtual size.
    const y = 246;
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
    //
    // Measured from the shipped PNGs, not from the nominal values: the XP text row inks y 246..252 and
    // the footer hint inks from y 261, so the whole free band is 253..260. The bar was at 256..260 —
    // flush against the footer, which is CC Friday's PR #17 finding (worst in the initials-entry state,
    // whose footer string is longer and reaches further left). A 2 px bar at 255..256 leaves 2 clear rows
    // above and 4 below in the worst (level-up / initials) state. A 3 px bar could not: the band only
    // admits 2+3+2, so the extra pixel has to come out of the bar, not out of the clearance.
    // Verified in all three Game Over shots by pixel-check.py, both gaps.
    const barX = 96, barY = y + 10, barW = 150, barH = 2;
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

  /**
   * W5: announce achievements unlocked by this run, in the top-left band the header leaves free.
   *
   * Fades out rather than lingering, so it does not sit under the leaderboard while the player reads the
   * panel. The tween is removed on shutdown like the resonance pulse, and nothing here blocks input.
   */
  _buildAchievementToast() {
    const awards = this.registry.get(REG.LAST_AWARDS) || null;
    const layout = toastLayout(awards ? awards.achievements : null, { ellipsize });
    if (!layout) return;
    this.toast = layout.lines.map((it) => {
      return new NeonText(this, this.theme, it.x, it.y, it.text, { color: it.color, outline: 'dark', alpha: it.alpha });
    });
    // 6.5 s: long enough to read a name and its description on the screen a player stares at after a
    // crash, short enough that it is gone before they pick a button.
    this.toastFade = this.tweens.add({
      targets: this.toast, alpha: 0, delay: 6500, duration: 700,
      onComplete: () => { for (const t of this.toast) t.destroy(); this.toast = []; },
    });
  }

  /** @returns {string} short "what unlocked" line, or the "next level" hint. */
  _rewardsLine(awards) {
    if (awards.leveledTo && Array.isArray(awards.rewardsEarned)) {
      const bits = [];
      // A new biome is the biggest unlock, so it goes first and is never cut: the line is limited to 280 px,
      // and a biome listed after a cosmetic or a boost lost its name to the ".." on a double level-up.
      const biomes = biomeOnlineLine(awards.rewardsEarned.filter((r) => r && r.biome).map((r) => r.biome), this && this.registry);
      for (const reward of awards.rewardsEarned) {
        if (!reward) continue;
        // Label the cosmetic as an unlock: a bare "TRAIL-CYAN" reads like a leftover id, not something
        // the player just earned (CC Friday's PR #17 note). Boosts stay bare-but-dashed for width.
        if (reward.cosmetic) bits.push(`UNLOCKED ${String(reward.cosmetic).toUpperCase().replace(/-/g, ' ')}`);
        if (reward.boost) bits.push(String(reward.boost).toUpperCase());
      }
      if (biomes) return withTail(biomes, bits.join(' / '), 280);
      if (bits.length) return ellipsize(bits.join(' / '), 280);
    }
    if (awards.leveledTo && awards.rewards) {
      const bits = [];
      if (awards.rewards.title) bits.push(String(awards.rewards.title).toUpperCase());
      if (awards.rewards.cosmetic) bits.push(String(awards.rewards.cosmetic).toUpperCase());
      if (awards.rewards.biome) return withTail(biomeOnlineLine([awards.rewards.biome], this && this.registry), bits.join(' / '), 280);
      if (bits.length) return ellipsize(bits.join(' / '), 280);
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
      { w: 110, label: 'TITLE', hint: 'ESC', color: 'magenta', fn: () => this.toTitle() },
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
    // A boosted run is NOT rankable while MODDED_RUNS_RANKED is false, so it must be judged against the
    // MODDED board and must never be offered clean-board initials or a seed best (CC Friday's W4 defect 4:
    // a boosted run was shown NEW TOP 10! and NEW SEED BEST, neither of which the clean board would keep).
    // The decision comes from Ranking.js, not from a flag test here.
    const draft=rec.dailyMode==='draft';
    const modded = boardsModded(rec);
    const when=new Date(rec.startedAt||Date.now());
    Promise.all([
      safe(() => draft ? store.qualifiesForDailyDraftTop10(rec.score,when)
        : (modded ? store.qualifiesForModdedTop10(rec.score) : store.qualifiesForTop10(rec.score)), false),
      safe(() => draft ? store.getDailyDraftLeaderboard(10,when)
        : (modded ? store.getModdedLeaderboard(10) : store.getLeaderboard(10)), []),
    ]).then(([qualifies, rows]) => {
      if (!this.alive || this.leaving) return;
      this.rows = Array.isArray(rows) ? rows : [];
      const already = this.rows.some((r) => r.id === rec.id);
      const worthy = this.rows.length >= 3 || (rec.score || 0) >= 200;
      if (qualifies && worthy && !already && (rec.score || 0) > 0 && rec.cause !== 'quit') this._showEntry();
      else this._showBoard(already ? rec.id : undefined, modded);
    });
  }

  /**
   * Compare this run with the device best (all stored runs except this one). Cosmetic, async, never blocks.
   *
   * A boosted run is compared against the MODDED board's histories, not against clean runs: telling a
   * boosted player they set a "DISTANCE BEST" the clean board will never show them is exactly the false
   * promise CC Friday caught.
   *
   * The reverse holds too: a clean run is compared only with runs a clean board may hold (Ranking.js
   * `rankableOnly`). Comparing it with every stored run told a clean player they were "8,400 M SHORT OF"
   * a Head Start run's distance (audit F-LEAD-2).
   */
  _loadBest(store, rec, safe) {
    const draft=rec.dailyMode==='draft';
    const modded = boardsModded(rec);
    safe(() => draft ? store.getDailyDraftLeaderboard(1000,new Date(rec.startedAt||Date.now()))
      : (modded ? store.getModdedLeaderboard(1000) : store.getRecentRuns(1000)), []).then((all) => {
      const runs = draft||modded||!Array.isArray(all) ? all : rankableOnly(all);
      if (!this.alive || !Array.isArray(runs) || rec.cause === 'quit' && !(rec.score > 0)) return;
      // The modded board only holds runs WITH initials, so the player's own just-finished run may not be in
      // it yet. Comparing against that board is still right: it is the list this run will actually appear on.
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
        if (m > bestM) this._montageBest();
        this.tweens.add({ targets: a, alpha: { from: 1, to: 0.4 }, duration: 260, yoyo: true, repeat: -1 });
        uiSfx(this, 'newBest');
        if (typeof this._fanfare === 'function') this._fanfare('best');
      }
    });
  }

  _showEntry() {
    const theme = this.theme;
    this.board.setVisible(false);
    // A boosted run only ever qualifies for the MODDED board (see _resolveBoard), so say so.
    this.right.setColorKey('lime').setTitle(boardsModded(this.rec) ? 'NEW MODDED TOP 10!' : 'NEW TOP 10!');
    const last = (this.registry.get(REG.SETTINGS) || {}).lastInitials || '';
    // Every y here comes from MissionsLayout.entryLayout(), where SAVE and the hint rects are asserted
    // disjoint. Hand-tuning these numbers is what put the SAVE button on top of both hint lines: the
    // entry widget draws its own SAVE at local 88..104, so hints at 84/96 were underneath it.
    const EL = entryLayout();
    const cx = Math.round(EL.title.x + EL.title.w / 2);
    this.entryGroup = [];
    const t1 = new NeonText(this, theme, cx, EL.title.y, 'ENTER YOUR INITIALS', { color: 'lime', anchor: 'center', outline: 'none' });
    this.right.add(t1);
    this.entry = new InitialsEntry(this, theme, {
      x: 0, y: EL.entryY, w: EL.panelW, length: INITIALS_LENGTH, initial: last, color: 'lime', onSubmit: (v) => this.saveEntry(v),
    });
    this.right.add(this.entry);
    const hint = new NeonText(this, theme, cx, EL.hints[0].y, 'TYPE / ARROWS / TAP  -  ENTER SAVES', { color: 'text', anchor: 'center', outline: 'none' });
    const hint2 = new NeonText(this, theme, cx, EL.hints[1].y, 'SPACE = SAVE + RETRY   ESC = SKIP', { color: 'text', anchor: 'center', outline: 'none' });
    hint.setAlpha(0.6);
    hint2.setAlpha(0.6);
    this.right.add([hint, hint2]);
    this.entryGroup = [t1, hint, hint2];
    this.input_.rawKeyHandler = (e) => this._rawKey(e);
    // While typing, keyboard B is a letter, not the shop key, so the hint would be a lie (audit UI-A).
    // _leaveEntry() puts it back once the entry is saved or skipped.
    this._hideShopHint();
    this.footer.setText('TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY');
    this._retryHint('SPACE = SAVE + RETRY');
    uiSfx(this, 'combo');
    if (typeof this._fanfare === 'function') this._fanfare('rank');
  }

  _rawKey(e) {
    if (typeof this.skipReveal === 'function') this.skipReveal();
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
    if (this._anythingAffordable()) this._buildShopHint();
  }

  _retryHint(text) {
    const b = this.buttons && this.buttons[0];
    if (b && b.hintText) b.hintText.setText(text);
  }

  skipEntry() {
    if (!this.entry) return;
    this._leaveEntry();
    this._showBoard(undefined, boardsModded(this.rec));
    this._resumeShopAutoprompt();
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
      const status = await store.setInitials(this.rec.id, initials);
      if (status === undefined && store.getRunPersistence?.(this.rec.id) === 'unknown') return false;
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
    const modded = boardsModded(this.rec);
    const draft=this.rec.dailyMode==='draft';
    this._leaveEntry();
    this.right.setColorKey('cyan').setTitle(draft?'DAILY DRAFT':modded ? 'MODDED' : 'LEDGER');
    const ok = await this._persist(initials);
    if (!this.alive || this.leaving) return;
    let rows = this.rows;
    if (ok) {
      try {
        const store = this.registry.get(REG.SAVE_STORE);
        rows = (await (draft?store.getDailyDraftLeaderboard(10,new Date(this.rec.startedAt||Date.now()))
          :modded ? store.getModdedLeaderboard(10) : store.getLeaderboard(10))) || [];
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
    this._showBoard(ok ? this.rec.id : undefined, modded);
    this._resumeShopAutoprompt();
  }

  /**
   * @param {string} [highlightId] this run's record id, if it is on the board being shown
   * @param {boolean} [modded] the run is boosted and therefore unranked on the clean board
   */
  _showBoard(highlightId, modded) {
    this.board.setVisible(true);
    this.board.setEntries(this.rows, highlightId);
    // Label the board the rows actually came from. A boosted run reading "TOP 10" over the MODDED board
    // would be a lie about which list the player is looking at.
    const title = this.rec?.dailyMode==='draft'
      ? (highlightId?'DAILY DRAFT // YOU MADE IT':'DAILY DRAFT // TOP 10')
      : modded
        ? (highlightId ? 'MODDED // YOU ARE ON THE BOARD' : 'MODDED // TOP 10')
        : (highlightId ? 'LEDGER // YOU ARE ON THE BOARD' : 'LEDGER // TOP 10');
    const store = this.registry?.get(REG.SAVE_STORE);
    const runId = this.rec?.id;
    const prefix = this.rec?.dailyMode === 'draft' ? 'DAILY DRAFT' : modded ? 'MODDED' : 'LEDGER';
    const persistence = store?.getRunPersistence?.(runId);
    const display = status => status === 'session-only' ? prefix + ' // SESSION ONLY'
      : status === 'pending' ? prefix + ' // SAVING' : title;
    this.right.setTitle(display(persistence));
    if (persistence === 'pending') {
      const token = {};
      this._boardPersistenceToken = token;
      store.whenRunSettled(runId).then(status => {
        if (this.alive && !this.leaving && !this.entry &&
            this.rec?.id === runId && this._boardPersistenceToken === token)
          this.right.setTitle(display(status));
      });
    } else this._boardPersistenceToken = null;
    this.modded = modded === true;
  }

  // ------------------------------------------------------------ W4.1 shop autoprompt

  /**
   * Footer hint + the auto-open timer.
   *
   * Marvin's request (via CC Friday, notes/cc-friday-shop-popup*.txt) is that a player who can buy
   * something is told so and taken there. CC's amendment fixed the frequency: the POPUP fires only when
   * this run newly made something affordable, but the HINT stays up whenever anything is affordable, so a
   * stockpile player can still open the shop on demand.
   */
  _buildShopAccess() {
    this.shopOpen = false;
    this.shopTimer = null;
    this.shopView = null;
    this.shopDim = null;
    this.shopHint = null;
    // Read the profile fresh: the registry value was set when this run was credited, so its bank already
    // includes this run's shards.
    const affordable = this._anythingAffordable();
    if (affordable) this._buildShopHint();

    // The popup decision was made by ProgressionService at credit time (it is the only place both the
    // before and after states are known), and published on the awards view.
    const awards = this.registry.get(REG.LAST_AWARDS) || null;
    if (!awards || !awards.shopAutoprompt) return;

    // A tapped/clicked screen or any keypress before the timer fires cancels it: the player is already
    // playing, and a panel appearing over a run they just restarted would be a bug report.
    this.shopTimer = this.time.delayedCall(SHOP_PROMPT_MS, () => {
      this.shopTimer = null;
      if (!this.alive || this.leaving) return;
      // A run that also makes the Top-10 is under initials entry right now. Remember the popup instead of
      // dropping it: _resumeShopAutoprompt() opens it once the entry is saved or skipped.
      if (this.entry) { this.shopPending = true; return; }
      if (this.shopOpen) return;
      this._openShop();
    });
    // Do not keep the scene alive on this timer alone.
    this.shopTimer.paused = false;
  }

  /**
   * Is anything in the shop buyable right now?
   * @returns {boolean}
   */
  _anythingAffordable() {
    try {
      return canAffordAnything(shopState(this.registry.get(REG.PROFILE)));
    } catch (e) {
      return false;
    }
  }

  /**
   * The quiet "SHOP: B / LB" line, right-aligned on the footer row.
   *
   * The footer already carries the retry hint centred, and the awards line sits at y 246. Rather than
   * invent a third row (there is no free band at 480x270), the hint is drawn on the same y as the footer,
   * anchored right, and the geometry is asserted in tests against the footer's measured ink width.
   */
  _buildShopHint() {
    // Never during initials entry: B types a letter there (audit UI-A).
    if (this.shopHint || this.entry) return;
    this.shopHint = new NeonText(this, this.theme, GAME_WIDTH - 4, GAME_HEIGHT - 5, SHOP_HINT, {
      color: 'amber', anchor: 'right', vAnchor: 0.5, outline: 'none',
    });
    this.shopHint.setAlpha(0.75);
  }

  /** @returns {void} */
  _hideShopHint() {
    if (!this.shopHint) return;
    this.shopHint.destroy();
    this.shopHint = null;
  }

  /**
   * Open the Shard Shop over Game Over.
   *
   * The shop is reachable from PROFILE at the Title screen, which stays true (Marvin: no Title menu item).
   * This is the same ShopView, so a purchase here behaves identically — including persisting — and closing
   * it lands back on Game Over with its buttons untouched.
   *
   * Decision 7: `requested` (B / LB) opens it armed, so Enter / pad A buy at once. The autoprompt opens it
   * unarmed for SHOP_ARM_MS (see there); until then the footer keeps its retry line, which is what Enter does.
   * @param {{requested?:boolean}} [o]
   * @returns {void}
   */
  _openShop(o = {}) {
    if (this.shopOpen || !this.alive || this.leaving) return;
    this._cancelShopAutoprompt();
    if (typeof this.skipReveal === 'function') this.skipReveal();
    this.shopOpen = true;
    this.shopArmed = false;
    // "SHOP: B / LB" reads as "open the shop" while it is open; _closeShop re-measures and puts it back.
    this._hideShopHint();
    // An interactive full-screen dim under the panel (depth 400 < the panel's 500), as Title and Pause do:
    // without it a click on empty panel space fell through to RETRY / NEW SEED / TITLE (audit U4b). It is
    // inert on purpose; Esc / pad B / the shop's BACK close the shop.
    this.shopDim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0, 0).setDepth(400).setInteractive();
    this.shopView = new ShopView(this, this.theme, { onClose: () => this._closeShop() });
    if (o && o.requested === true) {
      this._armShop();
    } else {
      this.shopArmTimer = this.time.delayedCall(SHOP_ARM_MS, () => {
        this.shopArmTimer = null;
        if (this.alive && this.shopOpen && !this.leaving) this._armShop();
      });
    }
  }

  /**
   * From now on Enter / pad A belong to the shop. The footer switches to the shop's keys, drawn above the
   * dim (depth 400) on the row under the panel (the panel ends at y 258, the footer ink starts at y 261).
   * @returns {void}
   */
  _armShop() {
    if (this.shopArmed || !this.shopOpen) return;
    this.shopArmed = true;
    if (this.shopArmTimer) {
      try { this.shopArmTimer.remove(false); } catch (e) { /* already gone */ }
      this.shopArmTimer = null;
    }
    const f = this.footer;
    if (f && typeof f.setText === 'function') {
      this.footerBeforeShop = { text: f.text, depth: f.depth || 0 };
      f.setText(SHOP_FOOTER);
      if (typeof f.setDepth === 'function') f.setDepth(501);
    }
  }

  /**
   * Close the shop and land back on Game Over with everything intact.
   * @returns {void}
   */
  /** Ghost favorites over Game Over (issue #56): G, or the GHOST FAV button. */
  _openGhosts() {
    const tape = this.registry.get(REG.LAST_GHOST_TAPE), library = this.registry.get(REG.GHOSTS);
    if (this.ghostView || this.shopOpen || !this.alive || this.leaving || !tape || tape.runId !== this.rec.id || !library) return;
    if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    if (typeof this.skipReveal === 'function') this.skipReveal();
    this.ghostDim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0, 0).setDepth(400).setInteractive();
    this.ghostView = new GhostFavoritesView(this, this.theme, { library, tape, onClose: () => this._closeGhosts() });
  }

  /**
   * Issue #68: Cemetery Montage entry point, above the RUN REPORT panel (the only free band at every board state:
   * the LEDGER title row grows to 'LEDGER // YOU ARE ON THE BOARD'). Shown when this run recorded a ghost tape and
   * the montage is not switched off; never opens by itself.
   */
  _buildMontageButton() {
    const tape = this.registry.get(REG.LAST_GHOST_TAPE);
    const style = sanitizeMontageStyle((this.registry.get(REG.SETTINGS) || {}).cemeteryMontage);
    this.montageBest = false;
    if (style === 'off' || !tape || tape.runId !== this.rec.id) return;
    this.montageBtn = new Button(this, this.theme, { x: 14, y: 36, w: 74, h: 14, label: 'MONTAGE  M', color: 'lime', onClick: () => this._openMontage() });
  }

  /** A new distance best: the montage is the celebration, so its button says so (static under reduced motion). */
  _montageBest() {
    this.montageBest = true;
    const b = this.montageBtn;
    if (!b || !this.alive) return;
    try { b.setLabel?.('NEW BEST  M'); } catch (e) { /* label is cosmetic */ }
    if (!isReducedMotion(this) && this.tweens) this.tweens.add({ targets: b, alpha: { from: 1, to: 0.55 }, duration: 420, yoyo: true, repeat: 5 });
  }

  /** Reuses the ghost overlay slot (ghostView / ghostDim), so pointer, retry and shutdown handling stay identical. */
  _openMontage() {
    const tape = this.registry.get(REG.LAST_GHOST_TAPE);
    if (!this.montageBtn || this.ghostView || this.shopOpen || !this.alive || this.leaving || !tape || tape.runId !== this.rec.id) return;
    if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    if (typeof this.skipReveal === 'function') this.skipReveal();
    this.ghostDim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(400).setInteractive();
    this.ghostView = new CemeteryMontageView(this, this.theme, {
      history: this.registry.get(ATTEMPT_HISTORY_KEY) || null, library: this.registry.get(REG.GHOSTS) || null,
      tape, heroIsBest: this.montageBest === true, onClose: () => this._closeGhosts(),
    });
  }

  _closeGhosts() {
    try { this.ghostView?.destroy(); } catch (e) { /* a failed teardown must not wedge the screen */ }
    this.ghostView = null;
    try { this.ghostDim?.destroy(); } catch (e) { /* already torn down */ }
    this.ghostDim = null;
  }

  _closeShop() {
    if (this.shopArmTimer) {
      try { this.shopArmTimer.remove(false); } catch (e) { /* already gone */ }
      this.shopArmTimer = null;
    }
    const f = this.footer;
    if (this.footerBeforeShop && f && typeof f.setText === 'function') {
      f.setText(this.footerBeforeShop.text);
      if (typeof f.setDepth === 'function') f.setDepth(this.footerBeforeShop.depth);
    }
    this.footerBeforeShop = null;
    this.shopArmed = false;
    if (this.shopView) {
      try { this.shopView.destroy(); } catch (e) { /* a failed teardown must not wedge the screen */ }
      this.shopView = null;
    }
    // Inline rather than a helper: the shop-prompt tests drive _closeShop on a hand-built context.
    if (this.shopDim) {
      try { this.shopDim.destroy(); } catch (e) { /* already torn down */ }
      this.shopDim = null;
    }
    this.shopOpen = false;
    // Re-measure: a purchase changes the bank, so the hint may now be wrong (nothing affordable left) or
    // newly right (a stockpile player who bought the cheap item).
    this._hideShopHint();
    if (this._anythingAffordable()) this._buildShopHint();
  }

  /**
   * Drop the pending auto-open. Called on any input, on retry, and on shutdown.
   *
   * Guarded because existing scene-level tests exercise `retry`/`newSeed`/`toTitle` on partial stubs built
   * before this feature existed; a teardown helper must never be the reason a retry throws.
   * @returns {void}
   */
  _cancelShopAutoprompt() {
    this.shopPending = false;
    if (!this.shopTimer) return;
    try { this.shopTimer.remove(false); } catch (e) { /* already gone */ }
    this.shopTimer = null;
  }

  /**
   * The initials entry just closed (SAVE or SKIP). If the popup came due while it was open, open it now,
   * after a short beat. RETRY / NEW SEED / TITLE cancel it like the first timer.
   * @returns {void}
   */
  _resumeShopAutoprompt() {
    if (!this.shopPending || !this.alive || this.leaving || this.shopOpen) return;
    this.shopPending = false;
    this._cancelShopAutoprompt();
    this.shopTimer = this.time.delayedCall(SHOP_AFTER_ENTRY_MS, () => {
      this.shopTimer = null;
      if (!this.alive || this.leaving || this.entry || this.shopOpen) return;
      this._openShop();
    });
  }

  // ------------------------------------------------------------ results reveal

  /** Tween through Motion.tweenProgress, tracked so skipReveal() can finish it. While skipping: instant. */
  _tw(o) {
    const t = tweenProgress(this, this._skipping ? { ...o, duration: 0, delay: 0 } : o);
    if (t) (this._rt = this._rt || []).push(t);
    return t;
  }

  /** Run `fn` after `ms` (on skip: at once, with `this._skipping` true). */
  _at(ms, fn) {
    return this._tw({ duration: 1, delay: ms, onUpdate: () => {}, onComplete: fn });
  }

  /** Fade an object to the alpha it had before the reveal hid it. */
  _fadeIn(obj, ms, delay) {
    if (!obj || !obj.scene) return;
    const a = obj._a === undefined ? 1 : obj._a;
    this._tw({ duration: ms, delay, ease: Ease.outQuad, onUpdate: (p) => { if (obj.scene) obj.setAlpha(a * p); } });
  }

  _openPanel(panel, delay, color) {
    if (!panel) return;
    this._at(delay, () => {
      if (!panel.scene) return;
      if (this._skipping) { panel.setAlpha(1).setScale(1, 1); return; }
      const t = transitionIn(this, panel, { w: panel.w, h: panel.h, color: this.theme.color(color), duration: 240 });
      if (t) (this._rt = this._rt || []).push(t);
    });
  }

  /**
   * Staged reveal: header slam, then the two panels unfold, the rows and tallies count up, and the buttons
   * and footer come in. Input is live throughout (it only ever fast-forwards, see skipReveal). Reduced motion:
   * everything fades in together, no slam, shake or count-up.
   */
  _startReveal() {
    this.revealDone = false;
    this._skipping = false;
    this._slam = false;
    this._rt = [];
    this.reduced = isReducedMotion(this);
    const rec = this.rec;
    const aw = this.registry.get(REG.LAST_AWARDS) || null;
    const quiet = [this.rule, this.crashLine, this.footer, this.shopHint, this.xpText, this.levelText, this.rewardsText, this.resonance,
      ...(this.buttons || [])].filter(Boolean);
    for (const o of quiet) o._a = o === this.rewardsText ? (aw && aw.leveledTo ? 1 : 0.7) : o.alpha;
    const panels = [this.left, this.right];
    if (this.reduced) {
      for (const o of quiet) { o.setAlpha(0); this._fadeIn(o, motionMs(200, true), 0); }
      for (const pn of panels) transitionIn(this, pn, { w: pn.w, h: pn.h, duration: 120 });
      this.revealDone = true;
      return;
    }
    // hide everything the staged reveal brings in
    for (const o of quiet) o.setAlpha(0);
    for (const pn of panels) pn.setAlpha(0);
    const stat = this.statRows || [];
    for (const g of stat) for (const o of g) { o._a = o.alpha; o.setAlpha(0); }
    this.scoreText.setText('0');
    for (const t of this.tallies || []) t.obj.setText(t.fmt(0));
    const sx = this.title.scaleX;
    const ghosts = [this.ghostA, this.ghostB];
    const all = [this.title, ...ghosts];
    const ghostA = 0.45;
    this.title.setAlpha(0);
    ghosts.forEach((g) => g.setAlpha(0));

    // 0: slam. The header drops in oversized and fast, the RGB split snaps shut, the screen flashes and shakes.
    this._slam = true;
    this._tw({
      duration: 260,
      ease: Ease.outCubic,
      onUpdate: (p) => {
        const k = lerp(2.4, 1, p);
        this.title.setScale(sx * k).setAlpha(Math.min(1, p * 4));
        const d = Math.round(lerp(22, 2, p));
        ghosts.forEach((g, i) => g.setScale(sx * k).setX(GAME_WIDTH / 2 + (i ? d : -d)).setAlpha(ghostA * Math.min(1, p * 3)));
      },
      onComplete: () => {
        all.forEach((o) => o.setScale(sx));
        this.title.setAlpha(1).setX(GAME_WIDTH / 2);
        this.ghostA.setX(GAME_WIDTH / 2 - 2).setAlpha(ghostA);
        this.ghostB.setX(GAME_WIDTH / 2 + 2).setAlpha(ghostA);
        this._slam = false;
        this.ghostT = 400;
      },
    });
    this._at(0, () => {
      if (this._skipping) return;
      uiSfx(this, 'glitch', { volume: 0.6 });
      this._flash();
      this._shockwave();
      const st = this.registry.get(REG.SETTINGS) || {};
      // Phaser camera Shake internally samples Math.random every render.
      // Use a named cosmetic stream, not the authoritative run RNG.
      const cam = this.cameras?.main;
      if (st.screenShake !== false && cam && !isReducedMotion(this)) {
        this._seededShake = { remaining: 220, x: cam.scrollX, y: cam.scrollY };
      }
    });
    // 260: rule + crash line, 330/470: panels unfold, 700: buttons + footer
    this._fadeIn(this.rule, 200, 260);
    this._fadeIn(this.crashLine, 200, 300);
    this._openPanel(this.left, 330, 'magenta');
    this._openPanel(this.right, 470, 'cyan');
    for (const o of [...(this.buttons || []), this.footer, this.shopHint, this.xpText, this.levelText, this.rewardsText, this.resonance]) this._fadeIn(o, 240, 760);
    // 560: rows slide in, score and row tallies count up with ticks
    stat.forEach((g, i) => g.forEach((o) => this._fadeIn(o, 160, 560 + i * 55)));
    this._tally(560);
  }

  _tally(delay) {
    const target = Number(this.rec.score) || 0;
    const items = this.tallies || [];
    const dur = Math.round(Math.min(1100, 380 + target * 0.12));
    const steps = 16;
    let lastStep = 0;
    this._tw({
      duration: dur,
      delay,
      ease: Ease.outCubic,
      onUpdate: (p, raw) => {
        this.scoreText.setText(fmtInt(Math.round(target * p)));
        for (const t of items) if (t.obj.scene) t.obj.setText(t.fmt(Math.round(t.to * p)));
        const stp = Math.floor(raw * steps);
        if (stp > lastStep && !this._skipping) {
          lastStep = stp;
          uiSfx(this, 'uiMove', { pitch: 0.8 + raw * 0.9, volume: 0.35 });
        }
      },
      onComplete: () => {
        this.scoreText.setText(fmtInt(target));
        for (const t of items) if (t.obj.scene) t.obj.setText(t.fmt(t.to));
        if (this._skipping) return;
        uiSfx(this, 'combo', { volume: 0.7 });
        // score punch
        this._tw({
          duration: 260,
          onUpdate: (_p, raw) => { if (this.scoreText.scene) this.scoreText.setScale(3 * (1 + 0.08 * Math.sin(Math.PI * raw))); },
          onComplete: () => { if (this.scoreText.scene) this.scoreText.setScale(3); this._finishReveal(); },
        });
      },
    });
  }

  _finishReveal() {
    if (this.revealDone) return;
    this.revealDone = true;
    const f = this._pendingFanfare;
    this._pendingFanfare = null;
    if (f) this._playFanfare(f);
  }

  /** Fast-forward to the final state. Safe to call any time, any number of times. @returns {void} */
  skipReveal() {
    if (this.revealDone || this._skipping || !this._rt) return;
    this._skipping = true;
    const list = this._rt;
    this._rt = [];
    for (const t of list) { try { t.stop(); } catch (e) { /* already finished */ } }
    this._skipping = false;
    this._slam = false;
    if (this.scoreText && this.scoreText.scene) this.scoreText.setScale(3);
    this._finishReveal();
  }

  _flash() {
    const r = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.35).setOrigin(0, 0).setDepth(9000);
    this._tw({ duration: 170, onUpdate: (p) => { if (r.scene) r.setAlpha(0.35 * (1 - p)); }, onComplete: () => { if (r.scene) r.destroy(); } });
  }

  /** A hard horizontal line blown out from the header's centre. */
  _shockwave() {
    const g = this.add.graphics().setDepth(9000);
    const y = 8 + Math.round((this.title.scaleY * 8) / 2) + 2;
    const col = this.theme.color('danger');
    this._tw({
      duration: 300,
      ease: Ease.outCubic,
      onUpdate: (p) => {
        if (!g.scene) return;
        g.clear();
        const w = Math.round(GAME_WIDTH * p);
        g.fillStyle(col, 0.5 * (1 - p));
        g.fillRect(Math.round((GAME_WIDTH - w) / 2), y, w, 2);
        g.fillStyle(0xffffff, 0.8 * (1 - p));
        g.fillRect(Math.round((GAME_WIDTH - w) / 2), y, w, 1);
      },
      onComplete: () => { if (g.scene) g.destroy(); },
    });
  }

  /**
   * NEW BEST ('best', around the score) or a Top-10 rank ('rank', around the ledger): a sparkle burst and a
   * pulsing glow. Queued until the reveal has finished so it lands on a settled screen.
   * @param {'best'|'rank'} kind
   */
  _fanfare(kind) {
    if (!this.alive) return;
    if (!this.revealDone) {
      if (this._pendingFanfare !== 'rank') this._pendingFanfare = kind;
      return;
    }
    this._playFanfare(kind);
  }

  _playFanfare(kind) {
    if (!this.alive || this.leaving || !this.left || !this.left.scene) return;
    const panel = kind === 'rank' ? this.right : this.left;
    const color = this.theme.color('lime');
    const reduced = isReducedMotion(this);
    // glow pulse: three breaths of a falling-alpha border outside the panel
    const g = this.add.graphics().setDepth(9000);
    this._tw({
      duration: reduced ? 400 : 1100,
      onUpdate: (_p, raw) => {
        if (!g.scene) return;
        g.clear();
        const k = reduced ? 1 - raw : (0.5 + 0.5 * Math.sin(raw * Math.PI * 6 - Math.PI / 2)) * (1 - raw * 0.6);
        glowRectPx(g, panel.x, panel.y, panel.w, panel.h, color, 1 + 5 * k);
        g.lineStyle(1, color, 0.5 * k);
        g.strokeRect(panel.x - 0.5, panel.y - 0.5, panel.w + 1, panel.h + 1);
      },
      onComplete: () => { if (g.scene) g.destroy(); },
    });
    if (reduced) return;
    if (kind === 'rank') this._sparkBurst(panel.x + panel.w / 2, panel.y + 70, 34);
    else {
      this._sparkBurst(panel.x + 56, panel.y + 52, 26);
      this._sparkBurst(panel.x + panel.w - 30, panel.y + 24, 18);
    }
  }

  /** Pixel sparks flung out from (x, y) that fall and twinkle out. */
  _sparkBurst(x, y, count) {
    const pal = this.theme.pal;
    const cols = [pal.lime, pal.amber, pal.cyan, pal.text];
    const sp = [];
    for (let i = 0; i < count; i++) {
      sp.push({
        a: cosmeticRandom('gameover/fx').next() * Math.PI * 2, v: 35 + cosmeticRandom('gameover/fx').next() * 95, life: 480 + cosmeticRandom('gameover/fx').next() * 420,
        c: cols[i % cols.length], size: cosmeticRandom('gameover/fx').next() < 0.3 ? 2 : 1, ph: i,
      });
    }
    const g = this.add.graphics().setDepth(9000);
    const dur = 950;
    this._tw({
      duration: dur,
      onUpdate: (_p, raw) => {
        if (!g.scene) return;
        g.clear();
        const t = raw * dur;
        for (const s of sp) {
          const k = t / s.life;
          if (k >= 1) continue;
          if (((Math.floor(t / 55) + s.ph) % 4) === 0) continue; // twinkle
          const sec = t / 1000;
          g.fillStyle(s.c, 1 - k * 0.7);
          g.fillRect(Math.round(x + Math.cos(s.a) * s.v * sec), Math.round(y + Math.sin(s.a) * s.v * sec + 70 * sec * sec), s.size, s.size);
        }
      },
      onComplete: () => { if (g.scene) g.destroy(); },
    });
  }

  // ------------------------------------------------------------ actions

  _onAction(action) {
    // Any input fast-forwards the results reveal to its final state, then still does what it always did.
    if (typeof this.skipReveal === 'function') this.skipReveal();
    // W4.1: any action cancels a pending auto-open — the player is already interacting.
    // Typing in the initials entry is not "the player is already playing": it must not drop a pending popup.
    if (!this.entry && typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    if (this.leaving) return;
    // Decision 7: Space / pad RB ('retry') retry from every state in one press: shop open or not, armed or
    // not, and during initials entry (where it saves first, like Space does there).
    if (action === 'retry') {
      if (this.shopOpen) this._closeShop();
      if (this.ghostView) this._closeGhosts();
      this.retry();
      return;
    }
    if (this.ghostView) { this.ghostView.handleAction(action); return; }
    if (action === 'ghost' && !this.shopOpen && !this.entry) { this._openGhosts(); return; }
    if (action === 'montage' && !this.shopOpen && !this.entry) { this._openMontage(); return; }
    if (this.shopOpen) {
      // Decision 7: in an ARMED shop Enter / pad A buy, equip, unequip or turn the page on the highlighted
      // row (ShopView's own rules, the same as Title -> Profile -> Shop). In an unarmed autoprompt shop
      // they keep the old close-and-retry, so a retry press already on its way is never swallowed.
      if (action === 'confirm') {
        if (this.shopArmed && this.shopView) { this.shopView.handleAction('confirm'); return; }
        this._closeShop();
        this.retry();
        return;
      }
      if (action === 'cancel') { this._closeShop(); return; }
      if (action === 'shop') { this._closeShop(); return; }
      if (action === 'alt') { this._closeShop(); this.newSeed(); return; }
      // Cursor movement (and left/right paging or toggles) belongs to the shop, and arms it: the row the
      // player moved to is the clearly selected one. Guarded like _cancelShopAutoprompt: older scene tests
      // drive _onAction on partial stubs.
      const move = action === 'up' || action === 'down' || action === 'left' || action === 'right';
      if (move && typeof this._armShop === 'function') this._armShop();
      if (this.shopView) this.shopView.handleAction(action);
      return;
    }
    if (this.entry) {
      // gamepad / touch routed actions while entering initials
      if (action === 'cancel' && !this.entry.handleAction('cancel')) this.skipEntry();
      else if (action !== 'cancel') this.entry.handleAction(action);
      return;
    }
    if (action === 'shop') {
      // The footer advertises this key, so it must open the shop even when the popup did not fire — a
      // stockpile player is told about the shop but not interrupted by it.
      if (this._anythingAffordable()) this._openShop({ requested: true });
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
    if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    // W1: the XP award is already committed (the service credits synchronously on RUN_END), so this
    // run cannot be banked twice by retrying. Cancel the cosmetic pulse so retry stays frame-one crisp.
    if (this.pulse) { this.pulse.remove(); this.pulse = null; }
    this._commitPending();
    if (this.rec.seed) this.registry.set(REG.SEED, this.rec.seed);
    // Decision 2: retrying the official Daily is another official attempt (the core chase loop: TODAY'S
    // BEST must count retries), and retrying a practice run stays practice. RunScene still requires the
    // seed to be TODAY's daily seed, so a retry after 00:00 UTC cannot back-fill yesterday.
    this.registry.set(REG.DAILY_OFFICIAL, this.rec.dailyOfficial === true);
    this.registry.set(REG.DAILY_MODE,this.rec.dailyMode==='draft'?'draft':'classic');
    this.registry.set(REG.DAILY_DRAFT_RANKS,this.rec.dailyMode==='draft'?{...(this.rec.upgradeRanks||{})}:{});
    // CC Friday: retry keeps the mask of the run being retried. Set it explicitly rather than letting the
    // previous value survive in the registry, which was correct only by accident.
    this.registry.set(REG.BIOME_MASK, Number(this.rec.biomeMask) || 0);
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    this.scene.start(SCENES.RUN);
  }

  /** @returns {void} */
  newSeed() {
    if (this.leaving) return;
    this.leaving = true;
    if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    this._commitPending();
    this.registry.set(REG.SEED, randomSeed());
    this.registry.set(REG.DAILY_OFFICIAL, false); // decision 2: a fresh seed is never the Daily
    this.registry.set(REG.DAILY_MODE,'classic');
    this.registry.set(REG.DAILY_DRAFT_RANKS,{});
    // A fresh seed is an ordinary run, so it uses the profile mask. Leaving the previous value behind
    // meant NEW SEED after a Daily run inherited that day's date-derived mask.
    this.registry.set(REG.BIOME_MASK, enabledBiomeMask(
      this.registry.get(REG.PROFILE),
      Object.values((this.registry.get(REG.CONTENT) || {}).biomes || {}),
    ));
    uiSfx(this, 'uiSelect');
    this.scene.start(SCENES.RUN);
  }

  /** @returns {void} */
  toTitle() {
    if (this.leaving) return;
    this.leaving = true;
    if (typeof this._cancelShopAutoprompt === 'function') this._cancelShopAutoprompt();
    this._commitPending();
    uiSfx(this, 'uiBack');
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  async _copySeed() {
    // Luna's round-2 finding: COPY handed over the bare seed while the panel showed seed@mask, so the
    // copy button pasted the player into a different world. Both now come from shareableSeed().
    const ok = await copyText(String(shareableSeed(this.rec) || ''));
    if (!this.alive) return;
    this.copyBtn.setLabel(ok ? 'OK!' : 'NO');
    this.seedText.setColorKey(ok ? 'amber' : 'danger');
    this.time.delayedCall(1500, () => {
      if (!this.alive) return;
      this.copyBtn.setLabel('COPY');
      this.seedText.setColorKey('lime');
    });
    if (!ok) this.footer.setText(`CLIPBOARD BLOCKED - SEED: ${String(shareableSeed(this.rec) || '').toUpperCase()}`);
  }

  update(time, delta) {
    const shake = this._seededShake;
    if (shake) {
      const cam = this.cameras?.main;
      shake.remaining = Math.max(0, shake.remaining - Math.max(0, delta));
      if (cam) {
        if (!shake.remaining || isReducedMotion(this)) {
          cam.setScroll(shake.x, shake.y);
          this._seededShake = null;
        } else {
          const rng = cosmeticRandom('gameover/shake');
          cam.setScroll(shake.x + (rng.next() * 2 - 1) * cam.width * 0.006,
            shake.y + (rng.next() * 2 - 1) * cam.height * 0.006);
        }
      } else this._seededShake = null;
    }
    this.backdrop.update(time);
    if (this.board && this.board.visible) this.board.tick(delta);
    // glitchy header (held still while the slam plays, and under reduced motion)
    if (this._slam || isReducedMotion(this)) return;
    this.ghostT -= delta;
    if (this.ghostT <= 0) {
      const j = cosmeticRandom('gameover/fx').next() < 0.25;
      this.ghostA.setX(GAME_WIDTH / 2 - (j ? 5 : 2));
      this.ghostB.setX(GAME_WIDTH / 2 + (j ? 5 : 2));
      this.title.setX(GAME_WIDTH / 2 + (j ? cosmeticRandom('gameover/fx').int(-2, 2) : 0));
      this.ghostT = j ? 90 : 700;
    }
  }
}
