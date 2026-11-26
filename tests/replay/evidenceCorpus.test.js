/** Historical real-recorded corpus, never a synthetic limit or fresh-SIM9 claim. */
import {measureEvidenceCorpus} from '../../tools/replay/measure-evidence-corpus.mjs';

describe('#244 historical recording envelope corpus',()=>{
  test('all committed replay recordings admit complete canonical evidence envelopes',()=>{
    const result=measureEvidenceCorpus();
    expect(result.recordingCount).toBeGreaterThanOrEqual(40);
    expect(result.rows.length).toBe(result.recordingCount);
    expect(result.uniqueEnvelopeCount).toBe(new Set(result.rows.map(r=>r.canonicalDigest)).size);
    expect(result.rows.every(r=>r.canonicalEnvelopeBytes>0&&r.gzipEnvelopeBytes>0)).toBe(true);
    expect(result.canonicalEnvelope.sum).toBe(result.rows.reduce((total,row)=>total+row.canonicalEnvelopeBytes,0));
    expect(result.uniqueDurableBytes).toBeGreaterThan(0);
    expect(result.caveats.some(c=>c.includes('not fresh current SIM9'))).toBe(true);
  });
});
