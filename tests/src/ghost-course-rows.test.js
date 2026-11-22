import { jest } from '@jest/globals';
import { GhostLibrary } from '../../src/systems/ghost/GhostLibrary.js';
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION } from '../../src/systems/ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { GHOST_COURSE_ROWS, readGhostCourseRows } from '../../src/ui/ghost-course-rows.js';

const roles = ['best', 'latest', 'fav0', 'fav1', 'fav2'];
const fixture = (id, distanceM, overrides = {}) => ({
  format: GHOST_TAPE_FORMAT, version: GHOST_TAPE_VERSION, physicsVersion: GHOST_PHYSICS_VERSION,
  simTickHz: SIM_TICK_HZ, seed: 'S1', biomeMask: 3, runId: id, distanceM, trace: 'AAAAAAAAAAAAAAAA',
  endedAt: new Date(2026, 10, 21, 12).getTime(), ...overrides,
});

async function courseFixture() {
  const library = new GhostLibrary();
  const best = fixture('best', 1234), latest = fixture('latest', 980);
  await library.saveRun(best);
  await library.saveRun(latest);
  await library.saveRun(fixture('other-mask', 100000, { biomeMask: 4 }));
  await library.saveRun(fixture('other-seed', 200000, { seed: 'S2' }));
  return { library, best, latest };
}

describe('Game Over local ghost roles', () => {
  test('looks up Best, Latest and favorite slots for the exact seed and mask, without changing the course', async () => {
    const { library, latest } = await courseFixture();
    const course = library.course(latest.seed, latest.biomeMask);
    expect(GHOST_COURSE_ROWS.map(({ role }) => role)).toEqual(roles);
    expect(GHOST_COURSE_ROWS.filter(({ slot }) => slot !== undefined).map(({ label }) => label)).toEqual(['FAV A', 'FAV B', 'FAV C']);
    const model = await readGhostCourseRows(library, latest);
    expect(model.map((row) => row.info)).toEqual(['1,234 M  11/21', 'THIS RUN', 'EMPTY', 'EMPTY', 'EMPTY']);
    expect(model.map((row) => row.saveLabel)).toEqual([null, null, 'SAVE', 'SAVE', 'SAVE']);
    expect(model.every((row) => row.on && !row.shared && !row.globalOff)).toBe(true);
    expect(library.course(latest.seed, latest.biomeMask)).toBe(course);
    expect((await readGhostCourseRows(library, { ...latest, biomeMask: 4 }))[1].info).toBe('100,000 M  11/21');
    expect((await readGhostCourseRows(library, { ...latest, seed: 'S2' }))[1].info).toBe('200,000 M  11/21');
    expect((await readGhostCourseRows(library, { ...latest, biomeMask: 5 })).every((row) => row.info === 'EMPTY')).toBe(true);
  });

  test('shows per-course choices separately from the existing global ceiling', async () => {
    const { library, best, latest } = await courseFixture();
    await library.setShow('S1', 3, 'best', false);
    await library.setFavorite('S1', 3, 0, latest.runId);
    await library.setShow('S1', 3, 'fav0', false);
    const settings = { ghostBest: true, ghostLatest: false };
    const model = await readGhostCourseRows(library, latest, settings);
    expect(model.map(({ on, globalOff }) => [on, globalOff])).toEqual([
      [false, false], [true, true], [false, false], [true, false], [true, false],
    ]);
    expect(settings).toEqual({ ghostBest: true, ghostLatest: false });
    expect(await library.ghostsFor('S1', 3, { best: true, latest: false })).toEqual([]);
    await library.setShow('S1', 3, 'best', true);
    expect((await library.ghostsFor('S1', 3, { best: true, latest: false })).map(({ runId }) => runId)).toEqual([best.runId]);
    expect(library.course('S1', 4).show).toBeUndefined();
  });

  test('reads each tape once and marks shared Best/Latest/Favorite without claiming a second rider', async () => {
    const library = new GhostLibrary(), current = fixture('one', 42);
    await library.saveRun(current);
    await library.setFavorite('S1', 3, 1, current.runId);
    const getTape = jest.spyOn(library, 'getTape');
    const rows = await readGhostCourseRows(library, current);
    expect(getTape).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.shared)).toEqual([true, true, false, true, false]);
    expect(rows.map((row) => row.saveLabel)).toEqual([null, null, 'SAVE', 'CLEAR', 'SAVE']);
    await library.setShow('S1', 3, 'best', false);
    await library.setShow('S1', 3, 'latest', false);
    expect((await library.ghostsFor('S1', 3)).map(({ runId }) => runId)).toEqual([current.runId]);
    await library.setFavorite('S1', 3, 1, null);
    expect(await library.ghostsFor('S1', 3)).toEqual([]);
  });

  test('marks a compatible short-run tape with no recorded poses as NO TRACE', async () => {
    const library = new GhostLibrary(), current = fixture('short', 0, { trace: '' });
    await library.saveRun(current);
    const rows = await readGhostCourseRows(library, current);
    expect(rows.map(({ info }) => info)).toEqual(['NO TRACE', 'NO TRACE', 'EMPTY', 'EMPTY', 'EMPTY']);
    expect(rows.every(({ shared }) => !shared)).toBe(true);
  });

  test.each([
    { format: 'unknown' }, { version: 0 }, { physicsVersion: 0 }, { simTickHz: 20 }, { trace: null },
  ])('maps the existing render compatibility checks independently of slot occupancy (%j)', async (changes) => {
    const { library, best, latest } = await courseFixture();
    await library.setFavorite('S1', 3, 0, best.runId);
    await library.setFavorite('S1', 3, 1, latest.runId);
    library.tapes.set(latest.runId, { ...latest, ...changes });
    library.tapes.delete(best.runId);
    const model = await readGhostCourseRows(library, latest);
    expect(model.map((row) => row.info)).toEqual(['TAPE MISSING', 'INCOMPATIBLE', 'TAPE MISSING', 'INCOMPATIBLE', 'EMPTY']);
    expect(model.map((row) => row.saveLabel)).toEqual([null, null, 'REPLACE', 'CLEAR', 'SAVE']);
    expect(model.every((row) => !row.shared)).toBe(true);
    expect(await library.ghostsFor('S1', 3)).toEqual([]);
  });
});
