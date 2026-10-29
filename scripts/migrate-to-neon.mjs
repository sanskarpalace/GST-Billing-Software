// One-off migration: push your local data/ folder into Neon Postgres.
//
// Usage (from the project root, with your Neon connection string):
//
//   # macOS / Linux
//   DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" node scripts/migrate-to-neon.mjs
//
//   # Windows PowerShell
//   $env:DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require"; node scripts/migrate-to-neon.mjs
//
// It (1) creates the table if needed, then (2) copies every data/<collection>/*.json
// row and the singletons (profile.json, meta.json, local-prefs.json) into the
// `store` table. Re-running is safe — rows are upserted by (collection, id).

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL to your Neon connection string first.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const COLLECTIONS = ['bills', 'clients', 'products', 'expenses', 'recurring', 'receipts', 'purchases', 'profiles', 'templates', 'trash'];
const SINGLETONS = [
  { file: 'profile.json',     id: 'profile' },
  { file: 'meta.json',        id: 'meta' },
  { file: 'local-prefs.json', id: 'local-prefs' },
];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } };

async function upsert(collection, id, data) {
  const json = JSON.stringify(data);
  await sql`
    INSERT INTO store (collection, id, data, updated_at)
    VALUES (${collection}, ${id}, ${json}::jsonb, now())
    ON CONFLICT (collection, id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()
  `;
}

async function main() {
  console.log('Applying schema…');
  await sql`CREATE TABLE IF NOT EXISTS store (
    collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, id))`;
  await sql`CREATE INDEX IF NOT EXISTS store_collection_idx ON store (collection)`;

  if (!existsSync(DATA_DIR)) {
    console.log('No local data/ folder found — schema created, nothing to migrate.');
    return;
  }

  let total = 0;
  for (const collection of COLLECTIONS) {
    const dir = path.join(DATA_DIR, collection);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let n = 0;
    for (const f of files) {
      const data = readJson(path.join(dir, f));
      if (!data) continue;
      const id = String(data.id || f.replace(/\.json$/, ''));
      await upsert(collection, id, data);
      n++; total++;
    }
    if (n) console.log(`  ${collection.padEnd(10)} → ${n} rows`);
  }

  for (const { file, id } of SINGLETONS) {
    const p = path.join(DATA_DIR, file);
    if (!existsSync(p)) continue;
    const data = readJson(p);
    if (data == null) continue;
    await upsert('singleton', id, data);
    console.log(`  singleton/${id} ✓`);
    total++;
  }

  console.log(`\nDone. ${total} rows migrated to Neon.`);
}

main().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
