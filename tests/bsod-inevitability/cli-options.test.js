import { spawnSync } from 'node:child_process';
const run = (args) => spawnSync(process.execPath, ['tools/bsod-inevitability/run.mjs', ...args], { encoding: 'utf8' });

test('rejects empty seed token instead of silently shrinking a controlled panel', () => {
  const r = run(['--seeds', 'sim-01,,sim-02', '--policies', 'handsOff']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/seed list must contain/i);
});

test('rejects empty policy token instead of silently dropping an arm', () => {
  const r = run(['--seeds', '2', '--policies', 'handsOff,,canopyHop']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/policies must be unique/i);
});
