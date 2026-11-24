import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('strict developer savestate CLI never admits cached or filtered receipts', () => {
  let dir, receipt;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-strict-cli-'));
    receipt = join(dir, 'receipt.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args, extra = {}) => {
    const env = { ...process.env, GAME_URL: 'http://127.0.0.1:1/' };
    delete env.ONLY; delete env.EXACT_ONLY;
    return spawnSync(process.execPath, ['tools/savestate-experiment/browser-experiment.mjs', ...args],
      { cwd: process.cwd(), env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 });
  };
  test.each([[['--repeat-moving']], [['--repeat-boundaries']], [['--repeat-ticks', '6']], [[]]])(
    'rejects an existing receipt in strict mode (%j)', mode => {
      const original = '[{"fixture":"moving","cached":true}]';
      writeFileSync(receipt, original);
      const r = run(['--strict-suffix', ...mode, '--json', receipt]);
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('--strict-suffix requires a new --json file and no case filters');
      expect(readFileSync(receipt, 'utf8')).toBe(original);
    });
  test('moving mode cannot bypass strict receipt validation', () => {
    const r = run(['--repeat-moving', '--json', receipt]);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--repeat-moving requires --strict-suffix');
  });
  test.each(['ONLY','EXACT_ONLY'])('rejects filtered strict moving mode (%s)', key => {
    const r = run(['--strict-suffix','--repeat-moving','--json',receipt], { [key]: 'moving' });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--strict-suffix requires a new --json file and no case filters');
  });
});

test('natural full-run mode cannot run without strict mode or with a repeat mode',()=>{
  for(const args of [['--natural-run'],['--strict-suffix','--natural-run','--repeat-moving'],['--strict-suffix','--natural-run','--natural-limit','0']]){
    const r=spawnSync(process.execPath,['tools/savestate-experiment/browser-experiment.mjs',...args],{encoding:'utf8',timeout:5000});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('natural mode requires strict');
  }
});
