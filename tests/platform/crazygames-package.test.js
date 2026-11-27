import { test, describe, expect } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessPortalPackage, inventoryDirectory, inventoryGitPublic, PORTAL_LIMITS } from '../../tools/platform/audit-crazygames-package.mjs';

describe('CrazyGames package preflight is evidence, not SDK approval', () => {
  test('empty fixture stays under static limits but initial load remains unverified', () => {
    const result = assessPortalPackage({ origin: 'fixture', files: [] });
    expect(result.passStaticLimits).toBe(true);
    expect(result.initialDownload).toMatch(/NOT MEASURED/);
    expect(result.privacyAndSdk).toMatch(/NOT AUDITED/);
  });

  test('SDK mode relaxes total bytes, but never the file limit', () => {
    const large = { origin: 'fixture', files: [{ name: 'a.dat', bytes: 60_000_000 }] };
    expect(assessPortalPackage(large).passStaticLimits).toBe(false);
    expect(assessPortalPackage(large, { sdk: true }).passStaticLimits).toBe(true);
    const many = { origin: 'fixture', files: Array.from({ length: PORTAL_LIMITS.files + 1 }, (_, i) => ({ name: `${i}.dat`, bytes: 1 })) };
    expect(assessPortalPackage(many, { sdk: true }).passStaticLimits).toBe(false);
  });

  test('directory audit counts nested files and byte sizes', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bb-portal-'));
    try {
      mkdirSync(path.join(root, 'music'));
      writeFileSync(path.join(root, 'game.js'), '123');
      writeFileSync(path.join(root, 'music', 'pack.bin'), '45678');
      const result = assessPortalPackage(inventoryDirectory(root), { sdk: true });
      expect(result.fileCount).toBe(2);
      expect(result.totalBytes).toBe(8);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects malformed or unsafe inventory data', () => {
    expect(() => assessPortalPackage({ files: [{ name: 'n', bytes: -1 }] })).toThrow();
    expect(() => inventoryGitPublic('--bad')).toThrow();
  });

  test('Git-tracked assets count correctly even in sparse worktrees', () => {
    const inventory = inventoryGitPublic('HEAD');
    const result = assessPortalPackage(inventory, { sdk: true });
    expect(result.fileCount).toBe(inventory.files.length);
    expect(result.totalBytes).toBe(inventory.files.reduce((total, item) => total + item.bytes, 0));
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.origin).toMatch(/^git:HEAD:public\/$/);
  });
});
