import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';

const rootFile = (name) => new URL(`../../${name}`, import.meta.url);

describe('retired engine cannot reappear in the active app', () => {
  test('pre-src engine and obsolete root repair snapshots are absent', () => {
    for (const name of [
      'js/',
      'fix-test-files.js',
      'fix-test-files-v2.js',
      'fix-test-files-v3.js',
      'fix-test-expectations.js',
      'package.json.fixed',
      'package.json.fixed2',
    ]) {
      expect(existsSync(rootFile(name))).toBe(false);
    }
  });

  test('the shared Phaser Jest mock stays available to maintained replay tests', () => {
    expect(existsSync(rootFile('tests/__mocks__/phaser.js'))).toBe(true);
  });

  test('production entry and former playground point at the current game', () => {
    const game = readFileSync(rootFile('index.html'), 'utf8');
    const retiredPage = readFileSync(rootFile('public/docs/index.html'), 'utf8');
    expect(game).toContain('/src/main.js');
    expect(retiredPage).toMatch(/http-equiv="refresh" content="0; url=\.\.\/"/);
    expect(retiredPage).toContain('href="../"');
    expect(retiredPage).not.toContain('/js/main.js');
  });
});
