import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const text = (path) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(text('public/manifest.webmanifest'));
const homepage = text('index.html');

function pngSize(path) {
  const data = readFileSync(resolve(root, path));
  expect(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  expect(data.subarray(12, 16).toString()).toBe('IHDR');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test('PWA metadata identifies exactly this game and stays on the current origin', () => {
  expect(manifest).toMatchObject({
    name: 'Bitstream Bluffs', short_name: 'Bitstream', id: '/', start_url: '/', scope: '/',
    display: 'standalone', orientation: 'landscape', background_color: '#05060f', theme_color: '#05060f',
    prefer_related_applications: false,
  });
  expect(manifest.description).toMatch(/arcade sledder/i);
  for (const field of ['id', 'start_url', 'scope']) {
    expect(new URL(manifest[field], 'https://bb.example').origin).toBe('https://bb.example');
  }
});

test('192/512 icons, safe-mask icon and Apple icon are valid matching PNGs', () => {
  const expected = [
    ['bitstream-192.png', 192, 'any'],
    ['bitstream-512.png', 512, 'any'],
    ['bitstream-512-maskable.png', 512, 'maskable'],
  ];
  expect(manifest.icons).toHaveLength(3);
  for (const [name, size, purpose] of expected) {
    const icon = manifest.icons.find((entry) => entry.src === `/icons/${name}`);
    expect(icon).toMatchObject({ sizes: `${size}x${size}`, type: 'image/png', purpose });
    expect(pngSize(`public/icons/${name}`)).toEqual([size, size]);
  }
  expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
});

test('the HTML uses the manifest and theme tags without interfering with normal boot', () => {
  const document = new DOMParser().parseFromString(homepage, 'text/html');
  expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest');
  expect(document.querySelector('meta[name="theme-color"]').content).toBe('#05060f');
  expect(document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('/icons/apple-touch-icon.png');
  expect(document.querySelector('script[type="module"]').getAttribute('src')).toBe('/src/main.js');
  expect(document.querySelector('#game-container')).not.toBeNull();
  expect(homepage).not.toMatch(/serviceWorker\.register|registerSW\s*\(/);
});

test('every declared asset uses first-party paths and the source menu artwork exists', () => {
  for (const icon of manifest.icons) {
    expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
    expect(existsSync(resolve(root, 'public' + icon.src))).toBe(true);
  }
  for (const name of ['logo-bitstream-fill.svg', 'logo-bluffs-fill.svg', 'rider-body.svg', 'rider-helmet.svg', 'rider-sled.svg']) {
    expect(existsSync(resolve(root, 'public/assets/menu', name))).toBe(true);
  }
});


test('Netlify advertises the registered manifest MIME type on the precise manifest route', () => {
  const config = text('netlify.toml');
  // A path-specific rule avoids changing content types for JS, JSON, media,
  // or the entire site. The PWA still does not register a service worker.
  expect(config).toMatch(/\[\[headers\]\]\s*for\s*=\s*"\/manifest\.webmanifest"\s*\[headers\.values\]\s*Content-Type\s*=\s*"application\/manifest\+json"/);
});
