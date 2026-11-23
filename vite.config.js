// Vite configuration for Bitstream Bluffs Phaser project
// See common-issues.md and llm-notes.md for any Vite/Phaser integration gotchas.
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public', // Use 'public' for static assets
  build: {
    chunkSizeWarningLimit: 2000,
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: ['./index.html', './tools/music/snowpack-audition.html', './tools/music/scrapheap-audition.html', './tools/music/hydrostatic-audition.html', './tools/music/microbox-audition.html', './tools/music/crystallattice-audition.html', './tools/music/scrap-clangs-audition.html', './tools/music/steamworks-audition.html', './tools/music/jellybloom-audition.html', './tools/music/ventforge-audition.html', './tools/music/sugarfizz-audition.html', './tools/music/orbitfield-audition.html', './tools/music/sunstone-audition.html', './tools/music/arcadeglue-audition.html', './tools/music/cross-pack-original-stem-audit.html'], // Game + isolated biome DSP auditions
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
