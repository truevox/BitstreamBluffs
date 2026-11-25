import {jest} from '@jest/globals';
jest.unstable_mockModule('vite',()=>({build:async()=>{}}));
const {renderRetiringWorker}=await import('../../tools/pwa/build-pwa-rollback.mjs');
test('retiring service worker does not clear a save or seize a running client',()=>{
 const code=renderRetiringWorker();
 expect(code).toMatch(/self\.registration\.unregister\(\)/);
 expect(code).not.toMatch(/skipWaiting|clients\.claim|caches\.delete|indexedDB\.deleteDatabase|cache\.delete/);
 expect(()=>new Function(code)).not.toThrow();
});
