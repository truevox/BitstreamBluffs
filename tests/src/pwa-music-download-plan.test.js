import { plannedTrackIds, makeSelectedMusicPlan, musicOfflineStatus, trackMusicFiles, makeIntegrityMusicManifest } from '../../tools/pwa/music-download-plan.mjs';

const rawCatalog = { format: 'bitstream-music-catalog-v1', tracks: [
  { id: 'songA', title: 'A', manifest: 'packs/A/pack.json' },
  { id: 'songB', title: 'B', manifest: 'packs/B/pack.json' },
] };
const pack = (id) => ({
  format: 'bitstream-music-pack-v1', id, frameCount: 48000, sampleRate: 48000,
  segments: [{ startFrame: 0, frames: 48000, sources: {
    vocals: '0000-vocals.ogg', drums: '0000-drums.ogg', bass: '0000-bass.ogg',
    guitar: '0000-guitar.ogg', piano: '0000-piano.ogg', other: '0000-other.ogg',
    'voice:bitstream-bluffs': '0000-voice-home.ogg',
  }}], captions: 'captions.json',
  adaptive: { featuredStem: 'guitar', variants: {
    bass: {}, drums: {}, featured: {}, guitar: {}, piano: {}, other: {},
  } },
});
const packs = { songA: pack('songA'), songB: pack('songB') };

test('current default: all offered unlocked songs are required, and per-song OFF skips files entirely', () => {
  expect(plannedTrackIds(rawCatalog)).toEqual(['songA', 'songB']);
  const disabled = makeSelectedMusicPlan(rawCatalog, packs, { songB: false });
  expect(disabled.songs).toHaveLength(1);
  expect(disabled.songs[0].id).toBe('songA');
  expect(disabled.songs[0].files).toContain('/music/packs/A/0000-drums.ogg');
  expect(disabled.songs[0].files).toContain('/music/packs/A/0000-voice-home.ogg');
  expect(disabled.songs[0].files).toContain('/music/packs/A/captions.json');
  expect(disabled.songs[0].files).not.toContain('/music/packs/B/0000-drums.ogg');
});

test('future track locks skip even ON tracks and unlocks add tracks on demand', () => {
  expect(plannedTrackIds(rawCatalog, {}, new Set(['songA']))).toEqual(['songA']);
  expect(plannedTrackIds(rawCatalog, {}, new Set(['songA', 'songB']))).toEqual(['songA', 'songB']);
  expect(musicOfflineStatus(rawCatalog, {}, ['songA'], ['songA'])).toEqual({ ready: true, songs: [
    { id: 'songA', status: 'ready' }, { id: 'songB', status: 'locked' },
  ]});
});

test('offline enable missing song keeps other song playable, marks missing download-required and no fake ready', () => {
  expect(musicOfflineStatus(rawCatalog, { songA: true, songB: false }, null, ['songA'])).toMatchObject({ ready: true });
  expect(musicOfflineStatus(rawCatalog, { songA: true, songB: true }, null, ['songA'])).toEqual({ ready: false, songs: [
    { id: 'songA', status: 'ready' }, { id: 'songB', status: 'download-required' },
  ]});
  expect(musicOfflineStatus(rawCatalog, { songA: true, songB: true }, null, ['songA', 'songB']).ready).toBe(true);
});

test('plan refuses incomplete active packs rather than silently using synthesized replacements', () => {
  expect(() => makeSelectedMusicPlan(rawCatalog, {songA:pack('songA')}, {})).toThrow(/Missing pack/);
  const bad = pack('wrong-song');
  expect(() => trackMusicFiles(rawCatalog.tracks[0], bad)).toThrow(/ID mismatch/);
});

test('selection statuses are independent of connectivity; disabling a missing song restores readiness', () => {
  const missing = musicOfflineStatus(rawCatalog, { songA: true, songB: true }, null, ['songA']);
  expect(missing.ready).toBe(false);
  expect(musicOfflineStatus(rawCatalog, { songA: true, songB: false }, null, ['songA'])).toMatchObject({ ready: true });
  expect(musicOfflineStatus(rawCatalog, { songA: false, songB: false }, null, []).ready).toBe(true);
});


test('on-disk versioned integrity manifest is reproducible, changes with actual audio bytes, and refuses missing stems', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'bb-music-inventory-'));
  try {
    const list = trackMusicFiles(rawCatalog.tracks[0], packs.songA);
    for (const url of list) {
      const target = join(root, url);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, `source-${url}`);
    }
    const selected = { songA: true, songB: false };
    const before = await makeIntegrityMusicManifest(root, rawCatalog, packs, selected);
    const again = await makeIntegrityMusicManifest(root, rawCatalog, packs, selected);
    expect(before).toEqual(again);
    expect(before.songs).toHaveLength(1);
    expect(before.songs[0].entries.every(e => /^[a-f0-9]{64}$/.test(e.sha256))).toBe(true);
    const stem = join(root, '/music/packs/A/0000-drums.ogg');
    writeFileSync(stem, 'new bytes');
    const changed = await makeIntegrityMusicManifest(root, rawCatalog, packs, selected);
    expect(changed.songs[0].version).not.toEqual(before.songs[0].version);
    unlinkSync(stem);
    await expect(makeIntegrityMusicManifest(root, rawCatalog, packs, selected)).rejects.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
