// Vite configuration for Bitstream Bluffs Phaser project
// See common-issues.md and llm-notes.md for any Vite/Phaser integration gotchas.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { stageApprovedPublic } from './tools/release/asset-policy.mjs';

export default defineConfig(({ command }) => ({
  plugins: [{
    name: 'release-approved-public-only',
    apply: 'build',
    closeBundle() {
      const count = stageApprovedPublic(resolve('public'), resolve('dist'));
      console.log('Approved public files staged:', count);
    },
  }],
  root: '.',
  // Default Vite copier was including *private* local music labs in dist.
  // Stage only approved release assets; leave local dev workflow unchanged.
  publicDir: command === 'serve' ? 'public' : false,
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
}));
