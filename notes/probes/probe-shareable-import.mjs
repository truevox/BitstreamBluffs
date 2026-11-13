/**
 * Luna W3 audit probe — does GameOverScene bind `shareableSeed`?
 *
 * A bare import-check, not a re-implementation: it reads the module's own source, extracts
 * every named binding it pulls from ui/Format.js and compares that set to the identifiers the
 * COPY path actually calls. Static, so it needs no Phaser canvas and cannot pass by accident.
 */
import fs from 'node:fs';

const SRC = 'src/scenes/GameOverScene.js';
const src = fs.readFileSync(SRC, 'utf8');

const formatImport = src.match(/^import\s*\{([^}]*)\}\s*from\s*'\.\.\/ui\/Format\.js';$/m);
if (!formatImport) {
  console.log('RESULT FAIL: no named import from ui/Format.js found at all');
  process.exit(1);
}

const bound = new Set(
  formatImport[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean),
);
const uses = [...src.matchAll(/\bshareableSeed\s*\(/g)].length;
const declaredLocally = /(function|const|let|var)\s+shareableSeed\b/.test(src);

console.log('Format.js named bindings :', [...bound].join(', '));
console.log('shareableSeed bound      :', bound.has('shareableSeed'));
console.log('shareableSeed declared   :', declaredLocally, '(local shadow would mask the bug)');
console.log('shareableSeed call sites :', uses);

const ok = (bound.has('shareableSeed') || declaredLocally) || uses === 0;
console.log(`\nRESULT ${ok ? 'PASS' : 'FAIL'}: ${ok
  ? 'every shareableSeed call resolves'
  : `${uses} call site(s) reference an unbound identifier -> ReferenceError the moment COPY runs`}`);
process.exit(ok ? 0 : 1);
