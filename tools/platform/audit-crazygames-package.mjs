/**
 * #445: offline inventory audit for CrazyGames package preparation.
 * No network, SDK initialization, ad requests or filesystem mutation.
 * A source-tree audit is not a guarantee that a selectively packaged build
 * has the same assets; audit the actual upload directory before submission.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const PORTAL_LIMITS = Object.freeze({
  files: 1500,
  totalWithSdkBytes: 250_000_000,
  totalWithoutSdkBytes: 50_000_000,
  initialBytes: 50_000_000,
  mobileHomeInitialBytes: 20_000_000,
});

export function inventoryGitPublic(ref = 'HEAD', root = ROOT) {
  if (!/^[A-Za-z0-9_./^-]+$/.test(ref) || ref.startsWith('-')) {
    throw new TypeError('Ref must be an ordinary Git revision, not an option');
  }
  const output = execFileSync('git', ['-C', root, 'ls-tree', '-r', '-l', ref, '--', 'public'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const files = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw new Error('Unexpected git ls-tree output');
    const columns = line.slice(0, tab).trim().split(/\s+/);
    if (columns[1] !== 'blob' || !/^\d+$/.test(columns[3])) throw new Error('Unsupported git tree entry');
    files.push({ name: line.slice(tab + 1), bytes: Number(columns[3]) });
  }
  return { origin: `git:${ref}:public/`, files };
}

export function inventoryDirectory(directory) {
  const resolved = path.resolve(directory);
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) throw new Error(`Symlink disallowed in upload inventory: ${full}`);
      if (info.isDirectory()) walk(full);
      else if (info.isFile()) files.push({ name: path.relative(resolved, full).split(path.sep).join('/'), bytes: info.size });
      else throw new Error(`Unsupported upload entry: ${full}`);
    }
  };
  walk(resolved);
  return { origin: `directory:${resolved}`, files };
}

export function assessPortalPackage(inventory, { sdk = false } = {}) {
  if (!inventory || !Array.isArray(inventory.files)) throw new TypeError('Invalid inventory');
  let totalBytes = 0;
  const groups = new Map();
  for (const item of inventory.files) {
    if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new TypeError('Invalid inventory file');
    totalBytes += item.bytes;
    if (!Number.isSafeInteger(totalBytes)) throw new RangeError('Inventory bytes overflow');
    const group = item.name.startsWith('public/music/packs/') ? 'public/music/packs/' : item.name.split('/').slice(0, 3).join('/');
    const value = groups.get(group) ?? { count: 0, bytes: 0 };
    value.count++;
    value.bytes += item.bytes;
    groups.set(group, value);
  }
  const totalLimit = sdk ? PORTAL_LIMITS.totalWithSdkBytes : PORTAL_LIMITS.totalWithoutSdkBytes;
  const failures = [];
  if (inventory.files.length > PORTAL_LIMITS.files) failures.push(`file count ${inventory.files.length} > ${PORTAL_LIMITS.files}`);
  if (totalBytes > totalLimit) failures.push(`total bytes ${totalBytes} > ${totalLimit} (${sdk ? 'SDK' : 'no SDK'} limit)`);
  return {
    origin: inventory.origin, sdk, fileCount: inventory.files.length, totalBytes,
    limits: PORTAL_LIMITS, totalLimitBytes: totalLimit,
    failures, passStaticLimits: failures.length === 0,
    initialDownload: 'NOT MEASURED: requires browser network capture through first playable state/SDK gameplayStart',
    privacyAndSdk: 'NOT AUDITED: release policy/SDK/consent/manual QA gates remain',
    largestGroups: [...groups.entries()].map(([name, data]) => ({ name, ...data })).sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  };
}

function main(args) {
  let sdk = false, json = false, directory = null, gitRef = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sdk') sdk = true;
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--directory' && args[i + 1]) directory = args[++i];
    else if (args[i] === '--git-ref' && args[i + 1]) gitRef = args[++i];
    else throw new Error(`Unknown/incomplete argument: ${args[i]}`);
  }
  if (directory && gitRef) throw new Error('Specify a directory or a Git ref, not both');
  const result = assessPortalPackage(directory ? inventoryDirectory(directory) : inventoryGitPublic(gitRef || 'HEAD'), { sdk });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.origin}: ${result.fileCount} files, ${(result.totalBytes / 1_000_000).toFixed(2)} MB`);
    console.log(`CrazyGames ${sdk ? 'SDK' : 'no-SDK'} static limits: ${result.passStaticLimits ? 'PASS' : 'FAIL'}`);
    for (const failure of result.failures) console.log(`  FAIL ${failure}`);
    for (const group of result.largestGroups.slice(0, 5)) console.log(`  ${group.name}: ${group.count} files, ${(group.bytes / 1_000_000).toFixed(2)} MB`);
    console.log(`  ${result.initialDownload}`);
    console.log(`  ${result.privacyAndSdk}`);
  }
  if (!result.passStaticLimits) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Audit error: ${error.message}`); process.exitCode = 2; }
}
