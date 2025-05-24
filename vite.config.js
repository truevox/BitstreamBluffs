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
      input: './index.html', // Main HTML moved to public/
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
