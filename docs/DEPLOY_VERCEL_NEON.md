# Deploy online with Vercel + Neon Postgres

This deploys the app as:

- **Frontend** → Vercel static hosting (the Vite `dist/` build, a PWA)
- **Backend** → one Vercel serverless function (`api/index.js`) that speaks the
  same `/api/*` API the app already uses — so **no frontend code changed**
- **Database** → Neon Postgres (one `store` table used as a document store)

> **Privacy / security note.** This puts your business data on the public
> internet. A **shared password** (HTTP Basic Auth via `APP_PASSWORD`) gates the
> whole app — set a strong one. For a single owner this is appropriate; it is
> not multi-user accounts. Indian records-localisation rules (DPDP Act 2023) may
> require on-premise storage for some businesses — check before going online.

---

## What you need (both free)

- A **Neon** account → <https://neon.tech>
- A **Vercel** account → <https://vercel.com>
- Your fork of this repo on **GitHub**

---

## Step 1 — Create the Neon database

1. Sign in to Neon → **New Project** (any name, region nearest you — e.g.
   *AWS ap-south-1 Mumbai* for India).
2. After it’s created, open **Connection Details**.
3. Choose the **Pooled connection** and copy the connection string. It looks
   like:
   ```
   postgres://USER:PASSWORD@ep-xxxx-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require
   ```
   Keep this secret — it is full access to your data.

## Step 2 — Create the table + migrate your existing data

From the project folder on your PC, with the connection string from Step 1:

**Windows PowerShell**
```powershell
$env:DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require"
node scripts/migrate-to-neon.mjs
```

**macOS / Linux**
```bash
DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" node scripts/migrate-to-neon.mjs
```

This creates the `store` table and copies every invoice, client, product,
expense, purchase, template, business profile and your settings/counters from
your local `data/` folder into Neon. Re-running it is safe (rows are upserted).

> Starting fresh with no local data? The script still creates the table — just
> nothing to copy. You can also run `db/schema.sql` by hand in Neon’s SQL editor.

## Step 3 — Push your code to GitHub

```bash
git add api vercel.json db scripts/migrate-to-neon.mjs package.json package-lock.json .gitignore .env.example docs/DEPLOY_VERCEL_NEON.md
git commit -m "Add Vercel + Neon online deployment"
git push
```
Your `data/` folder and `.env` are gitignored and will **not** be uploaded.

## Step 4 — Import the project into Vercel

1. Vercel → **Add New… → Project** → import your GitHub fork.
2. Vercel auto-detects **Vite**. Leave the defaults — `vercel.json` already sets:
   - Build command: `npm run build`
   - Output directory: `dist`
   - API function: `api/index.js`
3. Before the first deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Neon pooled connection string (Step 1) |
   | `APP_PASSWORD` | a long random password you’ll type to open the app |
   | `APP_USER` | `admin` (or any username) |
   | `APP_VERSION` | `online` (optional) |

4. Click **Deploy**. First build takes ~1–2 minutes.

## Step 5 — Open it

Visit `https://your-project.vercel.app`. The browser asks for the username /
password (`APP_USER` / `APP_PASSWORD`). After that the app runs exactly like the
local version — create invoices, download PDFs, everything — now backed by Neon.

Install it as a desktop/phone app from the browser’s **Install** button (it’s a PWA).

---

## Updating later

Push to your GitHub branch → Vercel redeploys automatically. (The in-app
“Update Now” button is disabled online — redeploying is how you update.)

## Backups

Your real online backup is the built-in **Settings → Backup & Restore → Download
All** (full JSON). Do it periodically. Neon also keeps its own point-in-time
history. The on-disk auto-backup feature is local-only and disabled online.

## What’s different online vs. local (by design)

| Feature | Local | Online (Vercel + Neon) |
|---|---|---|
| Data storage | `data/*.json` on your disk | Neon Postgres |
| Invoice PDFs | download + optional save to a server folder | download only (client-side) |
| On-disk auto-backups / “open data folder” | yes | disabled (use Export/Import) |
| In-app auto-update | yes | redeploy on Vercel |
| Recurring “Generate Now” | yes | yes |
| Recurring **daily auto-fire** | yes (PC stays on) | add a Vercel Cron → `/api/cron/recurring` (optional) |
| Login | none (localhost only) | shared password (`APP_PASSWORD`) |

### Optional: daily auto-fire for recurring invoices

Serverless has no always-on timer. To auto-generate due recurring invoices
daily, add this to `vercel.json` (needs a Vercel plan that includes Cron):

```json
"crons": [{ "path": "/api/cron/recurring", "schedule": "0 4 * * *" }]
```

---

## Troubleshooting

- **401 on every page** → `APP_PASSWORD` is set; enter the username/password. To
  check health without auth: `https://your-project.vercel.app/api/health`.
- **500 / “DATABASE_URL is not set”** → add the env var in Vercel and redeploy.
- **Health shows `ok:false`** → the connection string is wrong or the table is
  missing; re-check Step 1 and re-run Step 2.
- **Invoices from my PC are missing** → re-run the Step 2 migration (it reads
  your current local `data/` folder).
