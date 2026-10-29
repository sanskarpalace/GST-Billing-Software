-- Free GST Billing Software — Neon Postgres schema for the Vercel deployment.
-- Run this once against your Neon database (SQL editor, or the migration
-- script which applies it for you). Safe to re-run.
--
-- One table is used as a document store, mirroring the local app's
-- folders-of-JSON design 1:1. See api/db.js for how it is queried.

CREATE TABLE IF NOT EXISTS store (
  collection  text        NOT NULL,   -- bills | clients | products | expenses |
                                      -- recurring | receipts | purchases |
                                      -- profiles | templates | trash | singleton
  id          text        NOT NULL,   -- entity id, or 'profile'/'meta'/'local-prefs'
  data        jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

-- Fast per-collection listing (GET /api/bills, /api/clients, …).
CREATE INDEX IF NOT EXISTS store_collection_idx ON store (collection);
