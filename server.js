// server.js
// Simple HTTP server for local testing
// ------------------------------------------------------

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import http from 'http';

// Get __dirname equivalent in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create express app
const app = express();
const PORT = process.env.PORT || 8000;

// Serve static files from project root
app.use(express.static(__dirname));

// Create http server
const server = http.createServer(app);

// Start server
server.listen(PORT, () => {
  console.log(`🎮 Bitstream Bluffs server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log('🛑 Server shutting down');
  server.close(() => {
    console.log('👋 Server closed');
    process.exit(0);
  });
});
