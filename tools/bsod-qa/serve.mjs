#!/usr/bin/env node
/**
 * Local-only playable pursuit QA. The injected client is NOT part of index.html,
 * source builds, deploy previews, production saves, or canonical ruleset.
 *   node tools/bsod-qa/serve.mjs
 *   http://127.0.0.1:5174/?bsodQa=moderate&qaSeed=bsod-ab-01
 *   http://127.0.0.1:5174/?bsodQa=buffered&qaSeed=bsod-ab-01
 */
import { createServer } from 'vite';
const port = Number(process.env.BSOD_QA_PORT || 5174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError('Invalid QA port');
const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'bsod-qa-local-injection', apply: 'serve',
    transformIndexHtml(html) {
      return html.replace('</body>', '<script src="/tools/bsod-qa/boot-status.js"></script>\n<script type="module" src="/tools/bsod-qa/client.js"></script>\n</body>');
    },
    configureServer(devServer) {
      devServer.middlewares.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        next();
      });
    },
  }],
});
await server.listen();
console.log(`LOCAL QA ONLY http://127.0.0.1:${port}/?bsodQa=moderate&qaSeed=bsod-ab-01`);
console.log(`LOCAL QA ONLY http://127.0.0.1:${port}/?bsodQa=buffered&qaSeed=bsod-ab-01`);
