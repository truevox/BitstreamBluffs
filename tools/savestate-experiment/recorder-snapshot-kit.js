// Diagnostic-only GhostRecorder prefix codec. No production restore registration,
// no untrusted file admission, and no claim that a synthetic fixture is ranked.
import {digestOfBytes} from '../../src/systems/replay/canonicalSha256.js';
import {utf8Encode} from '../../src/systems/replay/canonicalJson.js';
const seal = data => digestOfBytes(utf8Encode(data));
const FIELDS = ['header','inputs','checkpoints','trace','fingerprints','fingerprintErrorCount',
  'fingerprintErrors','_last','_lastTick','lastTick'];
const CHANNELS = ['clock','rng','sled','matter','terrain','hazards','pickups','effects','bsod','kodiak','score','tricks','recovery'];
const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o,k));
const fail = reason => { throw new Error('recorder prefix: '+reason); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const uint = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n,-0);
const fp = s => typeof s === 'string' && /^xxh32x2:[0-9a-f]{16}$/.test(s);
const pad = (bits, tilt) => uint(bits) && bits < (3 << 18) && ((bits >>> 18) & 3) !== 3 &&
  Number.isInteger(tilt) && tilt >= -127 && tilt <= 127 && !Object.is(tilt,-0);
// Preserve signed zero on the JSON trip, including trace/checkpoint values.
function encode(value) {
  return JSON.stringify(value, (_k,v) => {
    if (typeof v === 'number') {
      if (!finite(v)) fail('nonfinite number');
      if (Object.is(v,-0)) return {__bbDiagnosticNegativeZero:true};
    }
    return v;
  });
}
function decode(bytes) {
  if (typeof bytes !== 'string' || bytes.length > 8*1024*1024) fail('invalid size/type');
  return JSON.parse(bytes, (_k,v) => sameKeys(v,['__bbDiagnosticNegativeZero']) &&
    v.__bbDiagnosticNegativeZero === true ? -0 : v);
}
function withoutStart(header) {
  const {startedAt,...rest}=header;
  return rest;
}
export function captureRecorderPrefix(run) {
  const rec = run.ghostRecorder;
  if (!sameKeys(rec,FIELDS)) fail('unclassified recorder fields');
  const data = encode({runId:run.runId,startedAt:run.startedAt,recorder:Object.fromEntries(FIELDS.map(k=>[k,rec[k]]))});
  return {kind:'bb-diagnostic-recorder-prefix',version:2,data,integrity:seal(data)};
}
export function prepareRecorderPrefix(run, section, tick) {
  if (!sameKeys(section,['kind','version','data','integrity']) || section.kind !== 'bb-diagnostic-recorder-prefix' || section.version !== 2)
    fail('missing or invalid section');
  if (!sameKeys(run.ghostRecorder,FIELDS) || typeof run.ghostRecorder.finish !== 'function')
    fail('fresh recorder missing or changed');
  if (run.simClock.tick !== 0 || run.ghostRecorder.lastTick !== 0 || run.ghostRecorder.inputs.length)
    fail('target is not fresh');
  if (typeof section.data !== 'string' || section.data.length > 8*1024*1024 || seal(section.data) !== section.integrity) fail('integrity mismatch');
  const decoded=decode(section.data);
  if (!sameKeys(decoded,['runId','startedAt','recorder'])) fail('metadata shape');
  const {recorder:r,runId,startedAt}=decoded;
  if (typeof runId !== 'string' || !runId || !uint(startedAt) || !sameKeys(r,FIELDS) ||
      !sameKeys(r.header,Object.keys(run.ghostRecorder.header)) ||
      r.header.startedAt !== startedAt || encode(withoutStart(r.header)) !== encode(withoutStart(run.ghostRecorder.header)))
    fail('header/identity mismatch');
  if (!uint(tick) || tick === 0 || r.lastTick !== tick || !Array.isArray(r.inputs) || !r.inputs.length ||
      !Array.isArray(r.trace) || !Array.isArray(r.checkpoints) || !Array.isArray(r.fingerprints) ||
      !Array.isArray(r.fingerprintErrors) || r.fingerprintErrorCount !== 0 || r.fingerprintErrors.length)
    fail('incomplete history');
  let sum=0;
  for (const row of r.inputs) {
    if (!Array.isArray(row) || row.length !== 3 || !uint(row[0]) || row[0] === 0 || !pad(row[1],row[2])) fail('invalid input row');
    sum += row[0];
    if (sum > tick) fail('input beyond capture tick');
  }
  if (r.inputs[0][0] !== 1 || r._lastTick !== sum || !Array.isArray(r._last) ||
      r._last.length !== 2 || !r._last.every((v,i)=>Object.is(v,r.inputs.at(-1)[i+1]))) fail('input cursor mismatch');
  const checkpoints=Math.floor(tick/120);
  if (r.trace.length !== Math.floor(tick/4)*3 || !r.trace.every(finite) ||
      r.checkpoints.length !== checkpoints || r.fingerprints.length !== checkpoints) fail('trace/checkpoint coverage');
  for (let i=0;i<checkpoints;i++) {
    const c=r.checkpoints[i], f=r.fingerprints[i], t=(i+1)*120;
    if (!Array.isArray(c) || c.length !== 8 || c[0] !== t || !c.every(finite) ||
        !sameKeys(f,['tick','combined','subsystems']) || f.tick !== t || !fp(f.combined) ||
        !sameKeys(f.subsystems,CHANNELS) || !CHANNELS.every(k=>fp(f.subsystems[k]))) fail('checkpoint/fingerprint mismatch');
  }
  return decoded;
}
export function applyRecorderPrefix(run, prepared) {
  run.runId=prepared.runId;
  run.startedAt=prepared.startedAt;
  for (const k of FIELDS) run.ghostRecorder[k]=prepared.recorder[k];
}
