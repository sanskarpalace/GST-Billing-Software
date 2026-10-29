// Sanskar Palace Billing — local desktop launcher.
//
// Runs the app on this computer (http://localhost:47371) using the SAME Neon
// cloud database as the online build, so every device that runs this shares
// the same data — with no Vercel hosting. It reuses the tested API from
// api/index.js and serves the built front-end from dist/.
//
// Setup on each device:
//   1. Install Node.js 18+.
//   2. Put your Neon connection string in a file named `.env` next to this
//      file:   DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
//   3. Run:   npm install  &&  npm run build      (first time only)
//   4. Run:   node desktop.mjs                    (or the launcher)
//
// Updates: push a release to GitHub; the app shows an "update available"
// banner (see /api/check-update). To apply, pull the new version and rebuild.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env (DATABASE_URL, optional APP_VERSION / UPDATE_REPO) without a dep.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

if (!process.env.DATABASE_URL) {
  console.error('\n  ✗ DATABASE_URL is not set.\n    Create a file named ".env" next to desktop.mjs with:\n      DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require\n');
  process.exit(1);
}
// Default the app version from package.json so the update check has a baseline.
if (!process.env.APP_VERSION) {
  try { process.env.APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { /* ignore */ }
}

const { default: apiApp } = await import('./api/index.js');

const app = express();
app.use(apiApp); // Neon-backed /api/* routes (and its own /api 404)

const dist = path.join(__dirname, 'dist');
if (!fs.existsSync(dist)) {
  console.error('\n  ✗ dist/ not found. Build the app first:  npm run build\n');
  process.exit(1);
}
app.use(express.static(dist));
// SPA fallback for client-side routes (GET only; /api already handled above).
app.use((req, res) => {
  if (req.method === 'GET') return res.sendFile(path.join(dist, 'index.html'));
  res.status(404).end();
});

const PORT = Number(process.env.PORT) || 47371;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Sanskar Palace Billing running at http://localhost:${PORT}`);
  console.log('  Data: Neon (cloud) — shared across your devices\n');
});
