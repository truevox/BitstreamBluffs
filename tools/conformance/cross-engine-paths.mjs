/**
 * #236: Separate immutable historical cross-engine tapes from new recordings.
 * Pure path selection never opens a browser or writes an artifact. Recording
 * creates ONE fresh directory atomically and never overwrites a tape or metadata.
 */
import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function canonicalFuturePath(input) {
  let ancestor = path.resolve(input);
  const missing = [];
  for (;;) {
    try { return path.join(realpathSync(ancestor), ...missing); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function selectTapeDirectory({ mode, explicit, historical }) {
  if (typeof historical !== 'string' || !path.isAbsolute(historical)) throw new Error('historical tape directory must be absolute');
  if (mode === 'record' && (typeof explicit !== 'string' || !explicit.trim())) {
    throw new Error('record requires CE_TAPE_DIR=/absolute/path/to/a/NEW/directory; committed historical tapes are read-only');
  }
  if (explicit !== undefined && (typeof explicit !== 'string' || !explicit.trim() || !path.isAbsolute(explicit))) {
    throw new Error('CE_TAPE_DIR must be an absolute directory path');
  }
  const selected = path.resolve(explicit || historical);
  if (mode === 'record') {
    // The ENTIRE committed fixtures collection is immutable: historical tapes
    // and source-stamped revision-specific sets, including future additions.
    const protectedRoot = realpathSync(path.dirname(historical));
    const destination = canonicalFuturePath(selected);
    if (within(destination, protectedRoot) || within(protectedRoot, destination)) {
      throw new Error('record destination overlaps the protected historical or versioned fixture tree');
    }
  }
  return selected;
}

export async function prepareRecordingDirectory(destination, historical) {
  // Recheck symlink resolution immediately before creating the directory.
  const selected = selectTapeDirectory({ mode: 'record', explicit: destination, historical });
  try {
    // NOT recursive: even an empty existing directory or a previous partial run
    // fails rather than silently reusing, truncating or overwriting evidence.
    await mkdir(selected);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('record destination already exists; choose a NEW directory to preserve previous evidence');
    throw error;
  }
  return selected;
}
