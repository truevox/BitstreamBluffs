// Foundation contract tests: event constants, constants, and that pure-logic stubs import without Phaser.
// Real per-module tests live next to this file (owned by the core-logic engineer).
import fs from 'fs';
import path from 'path';
import { EVT } from '../../src/events.js';
import * as C from '../../src/constants.js';
import { Rng } from '../../src/systems/Rng.js';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';
import { ScoreManager } from '../../src/systems/ScoreManager.js';
import { TrickTracker } from '../../src/systems/TrickTracker.js';
import { SaveStore } from '../../src/systems/SaveStore.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { GlitchDirector } from '../../src/systems/GlitchDirector.js';
import { PhysicsTuner, pxPerSecToStep } from '../../src/systems/PhysicsTuner.js';

const PURE = ['Rng', 'TerrainGenerator', 'ScoreManager', 'TrickTracker', 'SaveStore', 'DailyPatch', 'GlitchDirector'];

describe('foundation contract', () => {
  test('EVT is frozen with unique string values', () => {
    expect(Object.isFrozen(EVT)).toBe(true);
    const vals = Object.values(EVT);
    expect(new Set(vals).size).toBe(vals.length);
    vals.forEach((v) => expect(v).toMatch(/^bb:/));
  });

  test('constants sanity', () => {
    expect(C.GAME_WIDTH).toBe(480);
    expect(C.GAME_HEIGHT).toBe(270);
    expect(C.PHYSICS.gravityPxS2).toBe(900);
    expect(Object.keys(C.SCORING.trickBase).sort()).toEqual([...C.TRICK_TYPES].sort());
  });

  test('pure-logic stubs import no Phaser', () => {
    const forbid = [...PURE, 'GlitchDirector', 'PhysicsTuner'];
    for (const f of forbid) {
      const src = fs.readFileSync(path.resolve('src/systems', `${f}.js`), 'utf8');
      expect(src).not.toMatch(/from\s+['"]phaser['"]/);
    }
  });

  test('stubs construct and return sane defaults', () => {
    expect(new Rng('a').next()).toBeGreaterThanOrEqual(0);
    const gen = new TerrainGenerator({ seed: 's', chunkDefs: [], hazardDefs: {}, powerupDefs: {}, modDefs: {} });
    expect(gen.getChunk(0).points.length).toBeGreaterThan(1);
    expect(new ScoreManager().getSnapshot().total).toBe(0);
    expect(new TrickTracker().update({ grounded: true }).tricks).toEqual([]);
    expect(new SaveStore().loadSettings().version).toBe(1);
    expect(DailyPatch.getDailyInfo(new Date('2025-01-02T10:00:00Z')).dateKey).toBe('2025-01-02');
    expect(new GlitchDirector({ seed: 's' }).update(0, 0).started).toEqual([]);
    expect(new PhysicsTuner().getEffective({ tucked: false, zones: [] }).gravityPxS2).toBe(900);
    expect(pxPerSecToStep(600, 10)).toBeCloseTo(6);
  });
});
