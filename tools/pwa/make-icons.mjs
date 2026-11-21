/** Regenerate PWA PNG icons from first-party menu art; dev tool, not a build step. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = ['logo-bitstream-fill.svg', 'logo-bluffs-fill.svg', 'rider-body.svg', 'rider-helmet.svg', 'rider-sled.svg'];
const artwork = Object.fromEntries(await Promise.all(source.map(async (name) => [
  name, (await readFile(resolve(root, 'public/assets/menu', name))).toString('base64'),
])));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
try {
  const page = await browser.newPage();
  for (const [name, size, maskable] of [
    ['bitstream-192.png', 192, false],
    ['bitstream-512.png', 512, false],
    ['bitstream-512-maskable.png', 512, true],
    ['apple-touch-icon.png', 180, false],
  ]) {
    const png = await page.evaluate(async ({ artwork, size, maskable }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.scale(size / 512, size / 512);
      ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, 512, 512);
      const gradient = ctx.createLinearGradient(0, 0, 500, 500);
      gradient.addColorStop(0, '#071b32'); gradient.addColorStop(0.65, '#16113c'); gradient.addColorStop(1, '#321130');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
      // For adaptive masks, the logo and rider are strictly inside a conservative safe area.
      if (maskable) { ctx.translate(256, 256); ctx.scale(0.7, 0.7); ctx.translate(-256, -256); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#3cd9ec'; ctx.lineWidth = 5;
      ctx.strokeRect(27, 27, 458, 458);
      ctx.strokeStyle = 'rgba(255,112,192,.45)'; ctx.lineWidth = 2;
      ctx.strokeRect(35, 35, 442, 442);
      // Stylized two-tone terrain, matching the game's mountain/rider identity.
      ctx.fillStyle = '#192d53';
      ctx.beginPath(); ctx.moveTo(29, 365); ctx.lineTo(135, 283); ctx.lineTo(222, 344); ctx.lineTo(345, 257); ctx.lineTo(482, 365); ctx.lineTo(482, 480); ctx.lineTo(29, 480); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#20c5d1';
      ctx.beginPath(); ctx.moveTo(30, 424); ctx.lineTo(158, 342); ctx.lineTo(243, 381); ctx.lineTo(346, 314); ctx.lineTo(482, 386); ctx.lineTo(482, 480); ctx.lineTo(30, 480); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#080e29';
      ctx.beginPath(); ctx.moveTo(30, 458); ctx.lineTo(148, 409); ctx.lineTo(270, 445); ctx.lineTo(387, 380); ctx.lineTo(482, 429); ctx.lineTo(482, 480); ctx.lineTo(30, 480); ctx.closePath(); ctx.fill();
      const draw = async (name, x, y, w, h) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + artwork[name];
        await img.decode();
        ctx.drawImage(img, x, y, w, h);
      };
      await draw('logo-bitstream-fill.svg', 87, 91, 340, 58);
      await draw('logo-bluffs-fill.svg', 130, 157, 256, 64);
      // Reuse the original pixel-art rider layers. The composed pose is artwork,
      // not a screenshot or a promise that offline mode already exists.
      await draw('rider-body.svg', 310, 287, 135, 104);
      await draw('rider-helmet.svg', 310, 287, 135, 104);
      await draw('rider-sled.svg', 310, 287, 135, 104);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { artwork, size, maskable });
    await writeFile(resolve(root, 'public/icons', name), Buffer.from(png, 'base64'));
    console.log(`${name}: ${size}x${size}`);
  }
} finally {
  await browser.close();
}
