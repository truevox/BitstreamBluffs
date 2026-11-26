import { isBenignOptionalIconAbort } from '../../tools/pwa/offline-request-failure-policy.mjs';

const icon='/BitstreamBluffs/icons/apple-touch-icon.png';
test('only a cancelled optional apple-touch icon may be ignored during offline navigation',()=>{
  expect(isBenignOptionalIconAbort(icon,'net::ERR_ABORTED',icon)).toBe(true);
  for(const pathname of ['/BitstreamBluffs/sw.js','/BitstreamBluffs/manifest.webmanifest',
    '/BitstreamBluffs/assets/main.js','/BitstreamBluffs/audio/stem.ogg',
    '/icons/apple-touch-icon.png','/BitstreamBluffs/icons/icon-192.png'])
    expect(isBenignOptionalIconAbort(pathname,'net::ERR_ABORTED',icon)).toBe(false);
  for(const failure of ['net::ERR_FAILED','net::ERR_INTERNET_DISCONNECTED','net::ERR_BLOCKED_BY_CLIENT',''])
    expect(isBenignOptionalIconAbort(icon,failure,icon)).toBe(false);
});
