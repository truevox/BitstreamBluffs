import { fileURLToPath, URL } from 'node:url';
// Vite configuration for Bitstream Bluffs Phaser project
// See common-issues.md and llm-notes.md for any Vite/Phaser integration gotchas.
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public', // Use 'public' for static assets
  // The exact-build savestate schema uses semantic JS class identities.
  // Esbuild's default production renaming turns PowerUp into e.g. Gm and
  // makes canonical entity admission fail even for genuine stock gameplay.
  // Preserve constructor.name for both capture and isolated fresh restore.
  esbuild: {keepNames:true},
  build: {
    chunkSizeWarningLimit: 2000,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { game: fileURLToPath(new URL('./index.html', import.meta.url)), bsodQa: fileURLToPath(new URL('./bsod-qa.html', import.meta.url)), museum: fileURLToPath(new URL('./tools/museum-of-bad-physics.html', import.meta.url)) }, // Main HTML moved to public/
    },
  },
  server: {
    open: '/index.html', // Opens the main HTML on dev server start
    port: 5173,
  },
  resolve: {
    alias: {
      phaser: 'phaser', // Vite will resolve 'phaser' from node_modules
    },
  },
});
