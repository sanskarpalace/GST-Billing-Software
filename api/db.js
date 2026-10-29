// Neon Postgres document-store layer for the Vercel deployment.
//
// The local app stores each entity as a JSON file in data/<collection>/<id>.json
// and a few singletons (profile.json, meta.json, local-prefs.json) at the root.
// Online we keep the exact same shape in ONE Postgres table used as a
// key/value document store, so none of the frontend or the /api contract has
// to change:
//
//   store(collection text, id text, data jsonb, updated_at timestamptz)
//   primary key (collection, id)
//
// Collections map 1:1 to the old folders: bills, clients, products, expenses,
// recurring, receipts, purchases, profiles, templates, trash. The root
// singletons live in collection 'singleton' under ids 'profile', 'meta' and
// 'local-prefs'.
//
// Why a single statement for the counter increment: Vercel runs many function
// instances at once, so the local app's "read meta, +1, write meta" trick is
// NOT race-free here. We push the increment into one atomic SQL UPSERT instead
// (see incrementMeta), which the database serialises per row — closing the
// duplicate-invoice-number bug the local server's comment warns about.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  // Fail loud at cold start rather than returning confusing 500s per request.
  throw new Error('DATABASE_URL is not set. Add your Neon connection string as an environment variable.');
}

const sql = neon(process.env.DATABASE_URL);

// ---- Collection CRUD (mirrors readAllFromDir / readJSON / writeJSON / deleteFile) ----

// All rows of a collection, newest-irrelevant order (routes sort themselves).
export async function readAll(collection) {
  const rows = await sql`SELECT data FROM store WHERE collection = ${collection}`;
  return rows.map((r) => r.data);
}

// One row's data, or `fallback` when absent.
export async function readOne(collection, id, fallback = null) {
  const rows = await sql`SELECT data FROM store WHERE collection = ${collection} AND id = ${id} LIMIT 1`;
  return rows.length ? rows[0].data : fallback;
}

// True when a row exists (used for the 409 duplicate-invoice check + import gating).
export async function exists(collection, id) {
  const rows = await sql`SELECT 1 FROM store WHERE collection = ${collection} AND id = ${id} LIMIT 1`;
  return rows.length > 0;
}

// Upsert one row. Objects are bound as text and cast to jsonb explicitly
// (the neon() http client has no sql.json helper).
export async function writeOne(collection, id, data) {
  const json = JSON.stringify(data);
  await sql`
    INSERT INTO store (collection, id, data, updated_at)
    VALUES (${collection}, ${id}, ${json}::jsonb, now())
    ON CONFLICT (collection, id)
    DO UPDATE SET data = ${json}::jsonb, updated_at = now()
  `;
}

// Delete one row (no-op if absent).
export async function deleteOne(collection, id) {
  await sql`DELETE FROM store WHERE collection = ${collection} AND id = ${id}`;
}

// Move a row between collections keeping its id (used for soft-delete → trash
// and restore). Returns true if a row was moved.
export async function moveOne(fromCollection, toCollection, id) {
  const rows = await sql`
    UPDATE store SET collection = ${toCollection}, updated_at = now()
    WHERE collection = ${fromCollection} AND id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

// ---- Singletons ----
export const readProfile   = (fallback) => readOne('singleton', 'profile', fallback);
export const writeProfile  = (data)     => writeOne('singleton', 'profile', data);
export const readMeta      = (fallback = {}) => readOne('singleton', 'meta', fallback);
export const writeMeta     = (data)     => writeOne('singleton', 'meta', data);
export const readPrefs     = (fallback = {}) => readOne('singleton', 'local-prefs', fallback);
export const writePrefs    = (data)     => writeOne('singleton', 'local-prefs', data);

// ---- Atomic invoice counter ----
// One SQL statement, race-free across concurrent serverless instances.
// Mirrors utils.nextCounterValue(current, start) === max(floor(current)+1, clamp(start,1,MAX)).
// `startClamped` must already be clamped by the caller (1..MAX_START_NUMBER).
export async function incrementMeta(key, startClamped) {
  const start = Math.max(1, Math.floor(Number(startClamped) || 1));
  const rows = await sql`
    INSERT INTO store (collection, id, data, updated_at)
    VALUES ('singleton', 'meta', jsonb_build_object(${key}::text, ${start}::int), now())
    ON CONFLICT (collection, id) DO UPDATE SET
      data = jsonb_set(
        COALESCE(store.data, '{}'::jsonb),
        ARRAY[${key}::text],
        to_jsonb(GREATEST(COALESCE((store.data ->> ${key})::int, 0) + 1, ${start}::int))
      ),
      updated_at = now()
    RETURNING (data ->> ${key})::int AS value
  `;
  return rows[0].value;
}

export { sql };
