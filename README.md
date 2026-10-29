# Sanskar Palace Billing

Hotel billing **and** front‑desk software for **Sanskar Palace Hotel & Resort** —
GST‑compliant invoicing, a room‑by‑room booking board, check‑in / check‑out,
reservations and event blocks, all sharing one cloud database so every device
at the property sees the same data.

> Built on the open‑source **Free GST Billing Software by DiceCodes** (MIT),
> customised into a hotel edition. See [Credits](#credits--license).

---

## What it does

**Billing (GST)**
- Tax invoices, proforma, credit notes, bill of supply — GST‑compliant.
- Hotel defaults: **5% GST** (rooms ≤ ₹7,500/night slab, no ITC), SAC **996311**
  (rooms) / **996331** (F&B), unit “Day”.
- A **Rooms & Services** catalog (room types + F&B) with a “service” mode (no
  stock tracking), and a **Guests** directory with autocomplete.
- GST Returns (GSTR‑1 / 3B exports), Reports, Receipts, Recurring, Expenses,
  Income‑Tax helper.
- Invoices carry **check‑in / check‑out / nights / room no. / guests** and print
  in Tally format; a one‑line **“Subject to Garoth (M.P.) jurisdiction only.”**

**Front Desk (hotel operations)**
- **Board** grouped by floor (Ground / First / Second) showing every room’s live
  status today: **Vacant / Occupied / Reserved / Blocked**.
- **Check‑in / check‑out**; checkout can generate the GST invoice pre‑filled
  with nights × tariff, guest details and dates.
- **Reservations** for future arrivals, and a **History** of past stays.
- **Event blocks** — hold several rooms *and the Banquet / Conference halls* for
  a wedding or conference (single‑day events supported).
- **Double‑booking prevention** validated on the server, with a deliberate
  override for real exceptions (e.g. an event ends early and a room frees up).

Property data is pre‑loaded from the floor plan: **36 rooms** (3 Premium
Suites — 108, 109, 219; the rest Deluxe) plus **Banquet** and **Conference**
halls.

---

## How it runs

```
Browser → localhost:47371 → local backend (desktop.mjs) → Neon (cloud database)
```

- **Backend runs on each PC** (`desktop.mjs`, an Express app) — no always‑on
  cloud server.
- **Data lives in Neon** (serverless Postgres, free tier) so all devices share
  it over the internet.
- An optional **Vercel** deployment (`api/index.js` + the same code) can serve
  the app from a URL as a phone/remote fallback; it talks to the same Neon DB.

### Run it on a PC

See **[docs/DESKTOP.md](docs/DESKTOP.md)** for the full guide. Short version:

1. Install **Node.js 18+** (<https://nodejs.org>, LTS).
2. Download this repo (GitHub → **Code → Download ZIP**) and extract it.
3. Double‑click **`Start Sanskar Palace.bat`** → paste your Neon `DATABASE_URL`
   when asked (first run only) → it installs, builds, and opens
   <http://localhost:47371>.

Repeat on any device — they all share the same data.

### Updates

Push code and create a **GitHub Release** (tag like `v1.0.1`). The app shows an
**“update available”** banner (it checks `UPDATE_REPO`’s latest release). Apply
with `git pull && npm run build`, then restart and bump `APP_VERSION` in `.env`.

---

## Developer notes

```bash
npm install          # dependencies
npm run dev          # Vite dev server + local file-based API (server.js)
npm run build        # production build → dist/
node desktop.mjs     # serve dist/ + Neon API on localhost:47371 (needs .env)
```

- **Frontend:** React 19 + Vite (installable PWA). Main UI in `src/`.
- **Backend:** Express.
  - `desktop.mjs` / `api/index.js` → **Neon‑backed** (cloud DB), for desktop and
    Vercel respectively.
  - `server.js` → the original **file‑based** server (local `data/*.json`), used
    by `npm run dev`.
- **Database:** Neon Postgres via `@neondatabase/serverless`. One `store`
  table is used as a document store (`db/schema.sql`); `scripts/migrate-to-neon.mjs`
  seeds it from local files.
- **Config:** a local `.env` holds `DATABASE_URL` (and optional `APP_VERSION`,
  `UPDATE_REPO`, `APP_PASSWORD`). It is git‑ignored — never commit it.

### Vercel (optional web fallback)

`vercel.json` builds `dist/` and routes `/api/*` to `api/index.js`. A root
`middleware.js` adds a shared‑password gate when `APP_PASSWORD` is set. Set
`DATABASE_URL` and `APP_PASSWORD` in the Vercel project env. See
[docs/DEPLOY_VERCEL_NEON.md](docs/DEPLOY_VERCEL_NEON.md).

---

## Data & backups

- All business data (invoices, guests, rooms, bookings, settings) lives in
  **Neon**. Internet is required in this mode.
- **Back up** from **Settings → Backup & Restore → Download All** (full JSON)
  periodically; Neon also keeps its own history.

---

## Credits & license

Based on **[Free GST Billing Software](https://github.com/IamRamgarhia/Free-GST-Billing-Software)**
by **DiceCodes**, used under the **MIT License** (see [LICENSE](LICENSE)).
Hotel‑edition customisations and the Front Desk module are specific to Sanskar
Palace Hotel & Resort.
