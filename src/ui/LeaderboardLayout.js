/**
 * OWNER: UI engineer.
 * Phaser-free geometry for the leaderboard panel footer. `Views.js` draws what this returns, so the
 * footnote/tab collision can be asserted in Jest without booting Phaser — the same reason ProfileLayout,
 * ShopLayout and MissionsLayout exist.
 *
 * Why this module exists at all: W4 added a MODDED/CLEAN tab button on the same line as the footnote. The
 * footnote was 329px wide and the tab starts at panel-local x 272, so the tab's border cut through the last
 * word on BOTH boards. Nothing caught it — the Title and shop steps read drawn rects, the leaderboard step
 * only read the tab's label — so the overlap shipped in the gate-clean build.
 */
import { ellipsize, measureText } from './PixelFont.js';

/** Leaderboard panel, matching LeaderboardView's `super(...)` call. */
export const LEDGER_PANEL = Object.freeze({ w: 440, h: 178, y: 40 });

/** Left padding of the footnote, panel-local. */
export const LEDGER_FOOT_X = 12;

/**
 * The tab button's offset from the panel's right edge (`x: w - 148`) plus its width (68). Exported as an
 * inset so the footer bound and the button cannot drift apart: LeaderboardView positions the button from
 * this constant rather than from a literal.
 */
export const LEDGER_TAB_INSET = 148;
export const LEDGER_TAB_W = 68;
export const LEDGER_TAB_H = 16;

/** Vertical offset of the tab from the panel floor. */
export const LEDGER_TAB_DY = 24;

/** Vertical offset of the footnote from the panel floor. */
export const LEDGER_FOOT_DY = 18;

/** Minimum clear gap between the footnote's last glyph and the tab's border. */
export const LEDGER_FOOT_GAP = 8;

/**
 * The footnote text. Short on purpose: the panel title already says "TOP 10 ON THIS DEVICE", so "ONE LEDGER
 * PER DEVICE" was redundant and was most of what made the line too wide.
 */
export const LEDGER_FOOTNOTE = 'MAGENTA = DAILY PATCH. MODDED = BOOSTED RUNS.';

/**
 * Geometry of the footer band: where the footnote is drawn, how wide it may be, and where the tab sits.
 * @returns {{footX:number, footY:number, footMaxW:number, text:string, textW:number, fits:boolean,
 *            tab:{x:number,y:number,w:number,h:number}, tabLeft:number}}
 */
export function ledgerFooterLayout() {
  const tabLeft = LEDGER_PANEL.w - LEDGER_TAB_INSET;
  const footMaxW = tabLeft - LEDGER_FOOT_X - LEDGER_FOOT_GAP;
  const text = ellipsize(LEDGER_FOOTNOTE, footMaxW);
  const textW = measureText(text);
  return {
    footX: LEDGER_FOOT_X,
    footY: LEDGER_PANEL.h - LEDGER_FOOT_DY,
    footMaxW,
    text,
    textW,
    // Ellipsize alone would hide a regression behind ".." instead of failing it, so `fits` compares the
    // INTENDED text against the bound: a footnote that only fits when truncated is a footnote that is too
    // long for its own line.
    fits: measureText(LEDGER_FOOTNOTE) <= footMaxW,
    tabLeft,
    tab: {
      x: tabLeft,
      y: LEDGER_PANEL.h - LEDGER_TAB_DY,
      w: LEDGER_TAB_W,
      h: LEDGER_TAB_H,
    },
  };
}
