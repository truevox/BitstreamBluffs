/** Local-only Playwright driver for one fixed, neutral-input pilot. */
import { parseArgs } from 'node:util';
import { PILOT, PILOT_KEYS, assertHandsOffCapture, driveHandsOff, localPilotUrl, makeHandsOffReport, pilotBuildPin, pilotWithinDeadline } from './hands-off-pilot.js';

async function trial(browser, url, tape) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' })
    .catch(() => { throw new Error('Could not open a disposable Chromium context'); });
  let closing = false, failed = false, result;
  const routeError = (error) => {
    if (!closing || !/disposed|closed|cancelled|canceled/i.test(String(error))) failed = true;
  };
  try {
    await context.route('**/*', async (route) => {
      try {
        if (new URL(route.request().url()).origin !== url.origin) return await route.abort();
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) await route.abort();
        else await route.fulfill({ response });
      } catch (error) {
        routeError(error);
        if (!closing) await route.abort().catch(routeError);
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close().catch(routeError));
    const page = await context.newPage();
    page.on('pageerror', () => { failed = true; });
    await page.clock.setFixedTime(new Date(PILOT.calendarUtc));
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((title) => window.__bbGame?.scene.isActive(title), PILOT_KEYS.title);
    result = await pilotWithinDeadline(page.evaluate(driveHandsOff, { pilot: PILOT, keys: PILOT_KEYS, tape }));
  } catch (error) {
    const known = [
      'Pilot did not start in the expected normal stock scene', 'Pilot fixed-tick stepping stalled or changed cadence',
      'No single natural crash reached within the fixed-tick pilot', 'Pilot browser trial timed out',
    ].find((message) => String(error.message).includes(message));
    throw new Error(known ?? (tape ? 'Could not replay the local hands-off pilot' : 'Could not capture the local hands-off pilot'));
  } finally {
    closing = true;
    await context.close().catch(() => { throw new Error('Pilot browser context did not close cleanly'); });
  }
  if (failed) throw new Error('Browser or route error in hands-off pilot');
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8293/' },
    build: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    process.stdout.write('Usage: node tools/sim/verify-hands-off.mjs --build FULL_GIT_COMMIT [--url HTTP_LOOPBACK_PREVIEW]\n');
    return;
  }
  const build = pilotBuildPin(values.build), url = localPilotUrl(values.url);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
    .catch(() => { throw new Error('Could not launch local Chromium for the hands-off pilot'); });
  let report;
  try {
    const capture = await trial(browser, url, null);
    const replay = await trial(browser, url, assertHandsOffCapture(capture));
    report = makeHandsOffReport(capture, replay, build);
  } finally {
    await browser.close().catch(() => { throw new Error('Pilot browser did not close cleanly'); });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`Hands-off pilot: ${error.message}\n`); process.exitCode = 1; });
