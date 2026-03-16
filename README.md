# ProcureDB — Supplier Data Quality Tool

A lightweight procurement tool to keep supplier contacts, prices, and negotiation history up to date.

---

## Features

- Supplier database with health scores (0–100)
- Staleness alerts: contacts flag after 90 days, prices after 60 days
- One-click "Verify" buttons to timestamp data freshness
- Negotiation & activity history log per supplier
- Dashboard with stale record alerts
- Export all data to CSV
- Data stored in browser localStorage — no backend needed

---

## Deploy in 3 minutes (Vercel — recommended)

1. **Upload to GitHub**
   - Go to github.com → New repository → name it `procuredb`
   - Upload all these files (drag & drop the folder)

2. **Connect to Vercel**
   - Go to vercel.com → "Add New Project"
   - Import your GitHub repo
   - Framework: **Vite** (auto-detected)
   - Click **Deploy**

3. **Done** — you'll get a URL like `procuredb.vercel.app`

---

## Deploy in 30 seconds (StackBlitz — easiest)

1. Go to **stackblitz.com/new/react-vite**
2. Replace `src/App.jsx` with the contents of `src/App.jsx` from this folder
3. Click **Share** in the top bar → copy the live URL

---

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173

---

## Build for production

```bash
npm run build
```

Output goes to `/dist` — drag that folder into Netlify or any static host.

---

## Data & Privacy

All data is stored in your browser's `localStorage`. Nothing is sent to any server.
To back up your data, use the **Export CSV** button in the top right.
