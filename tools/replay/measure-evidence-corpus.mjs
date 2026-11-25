/** #244: real committed tape corpus -> complete legacy evidence envelopes.
 * Read-only, deterministic; no invented production captures, no uploads.
 * Run: node tools/replay/measure-evidence-corpus.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { legacyManifestFromTape, evidenceBundle, bundleBytes, validateEvidenceBundle } from '../../src/systems/replay/manifest.js';
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
const DIRECTORIES = Object.freeze([
  'tools/conformance/fixtures/cross-engine-sim6',
  'tools/conformance/fixtures/cross-engine',
  'tools/determinism/portable-math/fixtures',
  'tools/determinism/fixtures',
]);
const stat = values => {const s=[...values].sort((a,b)=>a-b);return {min:s[0],median:s[Math.floor((s.length-1)/2)],p95:s[Math.ceil(s.length*0.95)-1],max:s.at(-1),sum:s.reduce((a,b)=>a+b,0)};};
export function measureEvidenceCorpus(root=process.cwd()) {
  const rows=[];
  for(const dir of DIRECTORIES) {
    for(const file of fs.readdirSync(path.join(root,dir)).filter(x=>x.endsWith('.tape.json')).sort()) {
      const relative=path.posix.join(dir,file);
      const raw=fs.readFileSync(path.join(root,relative));
      const tape=JSON.parse(raw.toString('utf8'));
      const bytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(tape),tape}));
      const verdict=validateEvidenceBundle(bytes);
      if(!verdict.ok)throw Error(`${relative}: rejected ${verdict.code} ${verdict.pointer}`);
      rows.push({source:relative,simRevision:tape.simRevision??null,endTick:tape.endTick??null,
        inputRows:Array.isArray(tape.inputs)?tape.inputs.length:0,sourceTapeBytes:raw.length,sourceTapeSha256:createHash('sha256').update(raw).digest('hex'),
        canonicalEnvelopeBytes:bytes.length,gzipEnvelopeBytes:gzipSync(bytes,{level:6,mtime:0}).length,
        canonicalDigest:digestOfBytes(bytes)});
    }
  }
  const unique=new Map(rows.map(r=>[r.canonicalDigest,r]));
  return {format:'bb-real-recorded-legacy-evidence-corpus-v1',recordingCount:rows.length,
    uniqueEnvelopeCount:unique.size,recordingSources:DIRECTORIES,
    sourceTape:stat(rows.map(r=>r.sourceTapeBytes)),canonicalEnvelope:stat(rows.map(r=>r.canonicalEnvelopeBytes)),
    gzipEnvelope:stat(rows.map(r=>r.gzipEnvelopeBytes)),
    uniqueDurableBytes:[...unique.values()].reduce((n,r)=>n+r.canonicalEnvelopeBytes,0),
    caveats:['Historical checked-in recordings, not fresh current SIM9 production captures',
      'Legacy-derived canonical bb-replay-evidence envelopes; excludes IndexedDB keys, indexes, references and deletion tombstones',
      'Gzip size is a diagnostic only; actual IndexedDB stores uncompressed canonical bytes',
      'Repeated fixture recordings may share identical digest; unique count is deduplicated'], rows};
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const result=measureEvidenceCorpus();
  console.log(JSON.stringify(process.argv.includes('--json')?result:{...result,rows:undefined},null,2));
}
