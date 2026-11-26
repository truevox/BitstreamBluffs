/**
 * #67 stage 2b-3: the UI-free halves of "create a postcard from READY" and "open a postcard code / file". Local only:
 * clipboard and file save go through injected navigator / document objects; there is no network code at all.
 */
import { jest } from '@jest/globals';
import zlib from 'node:zlib';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor, validateTakeoverDescriptor } = await import('../../src/systems/replay/Takeover.js');
const { decodePostcard, encodePostcard, postcardWire, POSTCARD_PREFIX } = await import('../../src/systems/replay/Postcard.js');
const { currentPostcardIdentity, shareFromReady, copyText, saveFile, POSTCARD_EXT, shareFilename, shareLines } = await import('../../src/systems/replay/PostcardShare.js');
const { openPostcardText } = await import('../../src/systems/replay/PostcardOpen.js');
const { canonicalBytes } = await import('../../src/systems/replay/canonicalJson.js');
const { digestOf } = await import('../../src/systems/replay/canonicalSha256.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { liveFingerprint, readChallenge } = await import('../../src/systems/replay/PostcardChallenge.js');
const { SIM_REVISION } = await import('../../src/systems/replay/ruleset.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);
const codec = {
  deflate: async (b) => new Uint8Array(zlib.deflateRawSync(b, { level: 9 })),
  inflate: async (b, max) => { try { return new Uint8Array(zlib.inflateRawSync(b, { maxOutputLength: max })); } catch (e) { const x = new Error('z'); x.code = e.code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'bad-compression'; throw x; } },
};
const scripted = (t) => H.livePad({ push: t < 400, variableHop: true, noAutoNudge: true, hop: t >= 300 && t <= 303, pressed: { hop: t === 300 } });
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1000 });
const TAPE = REC.tape;
const TICK_MS = 1000 / 120;

function readyScene(N, { descriptor } = {}) {
  const d = descriptor || buildTakeoverDescriptor({ tape: TAPE, tick: N, source: 'last-run' });
  class T extends H.RunScene {
    create() { this.__starts = []; this.scene.start = (...a) => this.__starts.push(a); this.registry.set(H.RULESET_KEY, H.RULESET); this.registry.set(H.BUILD_ID_KEY, H.BUILD_ID); this.registry.set(H.REG.TAKEOVER, d); super.create(); }
  }
  const s = H.createRun(T, H.REG, { seed: 'IGNORED' });
  s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
  for (let i = 0; i < 400 && s.takeover.phase === 'seeking'; i++) s.update(0, TICK_MS);
  expect(s.takeover.phase).toBe('ready');
  s.registry.set(H.REG.LAST_GHOST_TAPE, TAPE);
  return s;
}

describe('identity of the running build', () => {
  test('is the exact sim revision, ruleset id and build id; incomplete until the build id is loaded', () => {
    const s = readyScene(300);
    expect(currentPostcardIdentity(s.registry)).toEqual({ gameVersion: expect.stringMatching(/^\d+\.\d+\.\d+/), simRevision: SIM_REVISION, rulesetId: CURRENT_RULESET_ID, buildId: H.BUILD_ID });
    s.registry.remove(H.BUILD_ID_KEY);
    expect(currentPostcardIdentity(s.registry).buildId).toBeNull();
  });
});

describe('creating a postcard from the READY screen', () => {
  test('takes fingerprint and challenge from the authoritative sim at N; default window 8 s; code starts BBPC1.', async () => {
    const s = readyScene(640);
    const r = await shareFromReady(s, { codec });
    expect(r.ok).toBe(true);
    expect(r.postcard.startTick).toBe(640);
    expect(r.postcard.windowTicks).toBe(8 * 120);
    expect(r.postcard.fingerprintAtStart).toBe(liveFingerprint(s));
    expect(r.postcard.challenge).toEqual(readChallenge(s));
    expect(r.code.startsWith(POSTCARD_PREFIX)).toBe(true);
    expect(await decodePostcard(r.code, { codec })).toMatchObject({ ok: true, postcard: r.postcard });
    expect(shareFilename(r.postcard)).toMatch(new RegExp(`^postcard-[0-9a-f]{12}\\${POSTCARD_EXT}$`));
    expect(POSTCARD_EXT).toBe('.bbpostcard');
    expect(shareLines(r.postcard).join('\n')).toMatch(/SPEED/);
  });
  test('the window is adjustable 5..10 s and clamped', async () => {
    const s = readyScene(640);
    for (const [sec, ticks] of [[5, 600], [10, 1200], [3, 600], [12, 1200], [7, 840]]) expect((await shareFromReady(s, { codec, windowSec: sec })).postcard.windowTicks).toBe(ticks);
  });
  test('only the run just played (in-session LAST_GHOST_TAPE) may fill a null build id; another tape with no build id is older-build', async () => {
    const nullTape = JSON.parse(JSON.stringify(TAPE)); nullTape.buildId = null;
    const d = buildTakeoverDescriptor({ tape: nullTape, tick: 640, source: 'last-run' });
    const s = readyScene(640, { descriptor: d });
    s.registry.set(H.REG.LAST_GHOST_TAPE, nullTape);
    expect((await shareFromReady(s, { codec })).ok).toBe(true); // same runId as the in-session tape
    s.registry.set(H.REG.LAST_GHOST_TAPE, { ...nullTape, runId: 'some-other-run' });
    expect(await shareFromReady(s, { codec })).toMatchObject({ ok: false, reason: 'older-build' });
    s.registry.remove(H.REG.LAST_GHOST_TAPE);
    expect(await shareFromReady(s, { codec })).toMatchObject({ ok: false, reason: 'older-build' });
  });
  test('refused outside READY, with no takeover, or while the build id is not loaded', async () => {
    expect(await shareFromReady({ takeover: null }, { codec })).toMatchObject({ ok: false, reason: 'not-ready' });
    const s = readyScene(640);
    s.takeover.phase = 'live';
    expect(await shareFromReady(s, { codec })).toMatchObject({ ok: false, reason: 'not-ready' });
    s.takeover.phase = 'ready';
    s.registry.remove(H.BUILD_ID_KEY);
    expect(await shareFromReady(s, { codec })).toMatchObject({ ok: false, reason: 'identity' });
  });
  test('a postcard takeover cannot be re-shared from READY (its tape holds only the prefix)', async () => {
    const s0 = readyScene(640);
    const first = await shareFromReady(s0, { codec });
    const { buildPostcardDescriptor } = await import('../../src/systems/replay/Postcard.js');
    const s = readyScene(640, { descriptor: buildPostcardDescriptor(first.postcard) });
    expect(await shareFromReady(s, { codec })).toMatchObject({ ok: false, reason: 'not-ready' });
  });
});

describe('local copy and save only', () => {
  test('copyText uses navigator.clipboard.writeText and reports success / failure; no clipboard API means a clear refusal', async () => {
    const calls = [];
    expect(await copyText('CODE', { clipboard: { writeText: async (t) => { calls.push(t); } } })).toEqual({ ok: true });
    expect(calls).toEqual(['CODE']);
    expect(await copyText('CODE', { clipboard: { writeText: async () => { throw new Error('denied'); } } })).toMatchObject({ ok: false });
    expect(await copyText('CODE', {})).toMatchObject({ ok: false });
    expect(await copyText('CODE', undefined)).toMatchObject({ ok: false });
  });
  test('saveFile makes a Blob object URL, clicks a download link named .bbpostcard, revokes the URL; no network', () => {
    const log = [];
    const doc = { createElement: (t) => { const el = { tag: t, click: () => log.push(['click', el.href, el.download]), remove: () => log.push(['remove']), style: {} }; return el; }, body: { appendChild: (e) => log.push(['append', e.tag]) } };
    const URLlike = { createObjectURL: (b) => { log.push(['blob', b.size, b.type]); return 'blob:local/1'; }, revokeObjectURL: (u) => log.push(['revoke', u]) };
    expect(saveFile('BBPC1.xyz', 'postcard-abc.bbpostcard', { document: doc, URL: URLlike, Blob })).toEqual({ ok: true });
    expect(log).toContainEqual(['click', 'blob:local/1', 'postcard-abc.bbpostcard']);
    expect(log).toContainEqual(['revoke', 'blob:local/1']);
    expect(log.find((e) => e[0] === 'blob')[2]).toMatch(/^text\/plain/);
    expect(saveFile('x', 'y.bbpostcard', {})).toMatchObject({ ok: false });
  });
  test('the share/open modules contain no network code at all', async () => {
    const fs = await import('node:fs');
    for (const f of ['PostcardShare.js', 'PostcardOpen.js', 'Postcard.js', 'PostcardChallenge.js', 'PostcardVerify.js']) {
      const src = fs.readFileSync(`src/systems/replay/${f}`, 'utf8');
      for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'http://', 'https://']) expect(src).not.toContain(bad);
    }
  });
});

describe('opening a postcard: decode, compatible, descriptor', () => {
  let code; let pc; const identity = () => currentPostcardIdentity({ get: (k) => (k === H.BUILD_ID_KEY ? H.BUILD_ID : undefined) });
  beforeAll(async () => { const r = await shareFromReady(readyScene(640), { codec }); code = r.code; pc = r.postcard; });

  test('a good code (pasted with whitespace, or from a file with a newline) opens into a valid fingerprint-only descriptor', async () => {
    for (const text of [code, `  ${code}\n`, `﻿${code}\r\n`, code.replace(/(.{60})/g, '$1\n  ')]) {
      const r = await openPostcardText(text, { identity: identity(), codec });
      expect(r.ok).toBe(true);
      expect(r.postcard).toEqual(pc);
      expect(r.descriptor).toMatchObject({ source: 'postcard', coverage: 'fingerprint-only', expectedFingerprint: pc.fingerprintAtStart, tick: 640 });
      expect(validateTakeoverDescriptor(r.descriptor, { rulesetId: CURRENT_RULESET_ID })).toEqual({ ok: true });
    }
  });
  test('refusals: not a postcard, tampered, other build, incomplete identity, a reply code, empty', async () => {
    const open = (t, id = identity()) => openPostcardText(t, { identity: id, codec });
    expect(await open('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(await open('hello world')).toMatchObject({ ok: false, reason: 'bad-prefix' });
    expect(await open(`BBPR1.${code.slice(6)}`)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    const i = 40; const flipped = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect((await open(flipped)).ok).toBe(false);
    // re-signed forgery with a patched build id: decodes, but this build refuses it
    const wire = postcardWire(pc); wire.buildId = `sha256:${'cc'.repeat(32)}`; wire.header.buildId = wire.buildId;
    const { digest, ...rest } = wire; wire.digest = digestOf(rest);
    const other = POSTCARD_PREFIX + Buffer.from(await codec.deflate(canonicalBytes(wire))).toString('base64url');
    expect((await decodePostcard(other, { codec })).ok).toBe(true);
    expect(await open(other)).toMatchObject({ ok: false, reason: 'other-build' });
    expect(await open(code, { ...identity(), buildId: null })).toMatchObject({ ok: false, reason: 'identity' });
    expect(await open(code, { ...identity(), simRevision: SIM_REVISION + 1 })).toMatchObject({ ok: false, reason: 'other-build' });
  });
  test('an oversize paste is refused before decoding', async () => {
    expect(await openPostcardText(POSTCARD_PREFIX + 'A'.repeat(300000), { identity: identity(), codec })).toMatchObject({ ok: false, reason: 'too-large' });
  });
});
