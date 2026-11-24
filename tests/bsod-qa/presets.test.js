import { BSOD_QA_PRESETS, parseBsodQaQuery } from '../../tools/bsod-qa/presets.mjs';

test('unrequested/unknown mode never activates', () => {
  expect(parseBsodQaQuery('')).toBeNull();
  expect(parseBsodQaQuery('?bsodQa=cheat')).toBeNull();
});
test('two presets keep the same gap and different chase pressure', () => {
  const m = parseBsodQaQuery('?bsodQa=moderate&qaSeed=shared-42');
  const b = parseBsodQaQuery('?bsodQa=buffered&qaSeed=shared-42');
  expect(m.seed).toBe(b.seed);
  expect(m.initialGapPx).toBe(4500);
  expect(b.initialGapPx).toBe(4500);
  expect(m.accelerationPxS2).toBeLessThan(b.accelerationPxS2);
  expect(Object.keys(BSOD_QA_PRESETS)).toEqual(['moderate','buffered','soft']);
});
test('malformed seed is replaced with a deterministic safe default', () => {
  expect(parseBsodQaQuery('?bsodQa=moderate&qaSeed=%2F..').seed).toBe('bsod-ab-01');
});
