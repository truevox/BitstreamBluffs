import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
	publicDir: false,
	base: '/',
	build: {
		outDir: resolve(here, '../../../dist-music-audition'),
		emptyOutDir: true,
		sourcemap: false,
		rollupOptions: { input: resolve(here, 'index.html') },
	},
});
