// Patch browser globals for Node test environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}
if (!globalThis.window.location) {
  globalThis.window.location = { hostname: 'localhost' };
}
