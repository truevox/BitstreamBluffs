import { readFileSync } from 'node:fs';
import { HISTORICAL_TAPE_BYTES, HISTORICAL_TAPE_SHA256, validatePinnedHistoricalAirtimeTape } from '../../tools/qa/historical-airtime-guards.js';

const fixture = readFileSync(new URL('../../tools/conformance/fixtures/cross-engine/collision-heavy.tape.json', import.meta.url));

describe('historical airtime fixture pin', () => {
  test('accepts only the original fixture and preserves its native older tape header', () => {
    expect(fixture.length).toBe(HISTORICAL_TAPE_BYTES);
    expect(HISTORICAL_TAPE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const tape = validatePinnedHistoricalAirtimeTape(fixture);
    expect(tape).toEqual(JSON.parse(fixture.toString('utf8')));
    expect(tape).toMatchObject({ kodiakVersion: 2, seed: 'CE120-BUMP3', endTick: 1668 });
    expect(tape.checkpoints.map(row => row[0])).toEqual(Array.from({ length: 13 }, (_, i) => (i + 1) * 120));
  });

  test('rejects a same-length byte change, even when the JSON remains valid', () => {
    const altered = Buffer.from(fixture);
    altered[altered.indexOf('CE120-BUMP3')] = 'B'.charCodeAt(0);
    expect(() => JSON.parse(altered.toString('utf8'))).not.toThrow();
    expect(() => validatePinnedHistoricalAirtimeTape(altered)).toThrow('exact committed synthetic');
  });

  test.each([
    ['short', fixture.subarray(0, -1)],
    ['padded', Buffer.concat([fixture, Buffer.from(' ')])],
    ['wrong type', fixture.toString('utf8')],
  ])('rejects %s input', (_, bytes) => {
    expect(() => validatePinnedHistoricalAirtimeTape(bytes)).toThrow('exact committed synthetic');
  });
});
