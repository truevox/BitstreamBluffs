/**
 * Readable Chaos, phase 3: the Game Over header line ("PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE") under CRASHED,
 * read from REG.LAST_CRASH for this run only. The shipped GameOverScene._buildHeader with a recording NeonText.
 */
import { jest } from '@jest/globals';

const texts = [];
class FakeNeonText {
  constructor(scene, theme, x, y, text, opts = {}) { Object.assign(this, { x, y, text, scale: opts.scale || 1, color: opts.color }); texts.push(this); }
  setAlpha() { return this; }
  setText(t) { this.text = t; return this; }
  setVisible() { return this; }
  setColorKey() { return this; }
  setDepth() { return this; }
  destroy() {}
}
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
jest.unstable_mockModule('../../src/ui/Neon.js', () => ({
  NeonText: FakeNeonText, neonText: () => new FakeNeonText(), strokeRectPx() {}, cornerTicks() {}, FONT_LINE_H: 9, measureText: () => 10,
}));

const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG } = await import('../../src/constants.js');
const { crashReport } = await import('../../src/systems/CrashReport.js');
const { loadContent } = await import('./_helpers.js');
const DEFS = loadContent().hazards;

const PANEL_Y = 54;
function header(rec, lastCrash) {
  texts.length = 0;
  const s = Object.create(GameOverScene.prototype);
  Object.assign(s, { rec, theme: {}, registry: { get: (k) => (k === REG.LAST_CRASH ? lastCrash : undefined) } });
  s._buildHeader();
  return { s, texts: [...texts] };
}
const report = (runId, seed = 'alpha') => crashReport({ runId, seed, startX: 0, pxPerMeter: 20, crashMs: 10000, cause: 'hazard', def: DEFS.packetSpike,
  x: 301.5 * 20, lastHopMs: 10000 - 130 + 210, arrivalMs: 10000 });
const LINE = 'PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE';

describe('Game Over header line', () => {
  test('this run crashed: the line sits under CRASHED, above the panels, in danger red', () => {
    const { s, texts: t } = header({ id: 'r1', seed: 'alpha', cause: 'crash', dailyRuleId: '' }, report('r1'));
    const line = t.find((x) => x.text === LINE);
    expect(line).toBeTruthy();
    expect(s.crashLine).toBe(line);
    const title = t.find((x) => x.text === 'CRASHED' && x.color === 'danger');
    expect(line.y).toBeGreaterThanOrEqual(title.y + 8 * title.scale);
    expect(line.y + 8).toBeLessThanOrEqual(PANEL_Y);
    expect(line.text.length * 6).toBeLessThanOrEqual(470);
  });
  test('with a daily rule line too: both fit above the panels without touching each other or the title', () => {
    const { texts: t } = header({ id: 'r1', seed: 'daily-2026-11-13', cause: 'crash', dailyRuleId: 'featherweight' }, report('r1', 'daily-2026-11-13'));
    const line = t.find((x) => x.text === LINE);
    const title = t.find((x) => x.text === 'CRASHED' && x.color === 'danger');
    const rule = t.find((x) => x.color === 'amber' && x.text);
    expect(rule && line).toBeTruthy();
    const rows = [title, rule, line].map((x) => [x.y, x.y + 8 * x.scale]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < rows.length; i++) expect(rows[i][0]).toBeGreaterThanOrEqual(rows[i - 1][1]);
    expect(rows[2][1]).toBeLessThanOrEqual(PANEL_Y);
  });
  test('no line for another run, a quit, or nothing stored; the header is as before', () => {
    for (const [rec, lc] of [
      [{ id: 'r2', seed: 'alpha', cause: 'crash' }, report('r1')],
      [{ id: 'r1', seed: 'alpha', cause: 'quit' }, report('r1')],
      [{ id: 'r1', seed: 'alpha', cause: 'crash' }, undefined],
    ]) {
      const { texts: t } = header(rec, lc);
      expect(t.some((x) => x.text === LINE)).toBe(false);
      expect(t.find((x) => x.color === 'danger').scale).toBe(4);
    }
  });
});
