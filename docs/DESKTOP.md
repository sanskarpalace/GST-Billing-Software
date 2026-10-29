# Run as a desktop app (no Vercel) — data in Neon

This runs Sanskar Palace Billing **on your own computer** at
`http://localhost:47371`, using your **Neon** cloud database so every device
shares the same data. **Vercel is not used** — the backend (`desktop.mjs`) runs
locally and connects straight to Neon.

```
Browser → localhost:47371 → desktop.mjs (local backend) → Neon (cloud DB)
```

## Install on a device (one time)

1. Install **Node.js 18+** from <https://nodejs.org> (the LTS build).
2. Get the app folder on the PC — download the repo ZIP from your GitHub
   **Releases**, or `git clone` it. Extract it somewhere permanent.
3. In that folder, create a file named **`.env`** with your Neon string:
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@ep-...-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   APP_VERSION=1.0.0
   # UPDATE_REPO=sanskarpalace/GST-Billing-Software   # which repo to check for updates
   # APP_PASSWORD=                                     # leave blank on a private PC (no login)
   ```
4. Double-click **`Start Sanskar Palace.bat`** (Windows). The first run installs
   dependencies and builds the app (a couple of minutes), then opens the browser.
   - Not Windows / prefer the terminal: `npm install && npm run build` once, then
     `node desktop.mjs`.

From then on, just double-click the launcher. Each device you repeat this on
sees the **same data** (because they all point at the same Neon DB).

## Updates (from GitHub releases)

- Push your code and create a **GitHub Release** (tag like `v1.0.1`).
- The app checks `UPDATE_REPO`'s latest release and shows an **"update
  available"** banner when the tag differs from `APP_VERSION`.
- To apply on a PC: pull/download the new version and rebuild —
  `git pull && npm install && npm run build`, then restart the launcher. Bump
  `APP_VERSION` in `.env` to match the release so the banner clears.

## Notes

- **Internet is required** (the app talks to Neon). It is not fully offline in
  this mode — that's the trade-off for shared, multi-device data.
- **Backups:** use **Settings → Backup & Restore → Download All** (full JSON)
  periodically; Neon also keeps its own history.
- **Keep it private:** don't commit your `.env` (it holds the DB password) — it
  is already in `.gitignore`.
- The on-disk features from the original offline build (auto-replace updater,
  local PDF archive, on-disk auto-backups) are not wired up in this Neon-backed
  desktop mode; Export/Import is your backup and PDFs download from the browser.
