# PO Tracker — Deployment Guide

A production order time tracker that runs as a full-screen app on your Android phone.

---

## Files in this package

```
po-tracker/
├── index.html      ← The entire app
├── manifest.json   ← PWA manifest (makes it installable)
├── sw.js           ← Service worker (offline support)
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## Deploy to GitHub Pages (5 minutes)

### Step 1 — Create a GitHub repository

1. Go to https://github.com and sign in
2. Click **+** → **New repository**
3. Name it `po-tracker` (or anything you like)
4. Set it to **Public**
5. Click **Create repository**

### Step 2 — Upload the files

**Option A — GitHub web UI (easiest, no git required)**

1. On your new repo page, click **uploading an existing file**
2. Drag and drop ALL files from this folder:
   - `index.html`
   - `manifest.json`
   - `sw.js`
3. Click **Commit changes**
4. Now click **Add file → Upload files** again
5. Open the `icons/` folder and upload:
   - `icon-192.png`
   - `icon-512.png`
6. In the path field at the top, type `icons/` before the filename — GitHub will create the folder
7. Click **Commit changes**

**Option B — Git command line**

```bash
cd po-tracker
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/po-tracker.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages** (left sidebar)
2. Under **Source**, select **Deploy from a branch**
3. Choose branch: **main**, folder: **/ (root)**
4. Click **Save**
5. Wait ~60 seconds, then your app is live at:
   ```
   https://YOUR_USERNAME.github.io/po-tracker/
   ```

---

## Install on your Android phone

1. Open **Chrome** on your Android phone
2. Navigate to `https://YOUR_USERNAME.github.io/po-tracker/`
3. A banner will appear at the bottom: **"Add PO Tracker to home screen"**
4. Tap **Install**
5. The app appears on your home screen like a native app ✓

If the banner doesn't appear:
- Tap the **⋮ menu** in Chrome → **Add to Home screen**

---

## Features

- **Barcode scanning** via phone camera (ZXing library)
- **Manual PO entry** as fallback
- **Tag system**: Gantry, Air Prep, Kits, Wiring, and more
- **Multiple sessions** per order — start/stop as many times as needed
- **CNF flagging** — mark sessions as entered in SAP
- **Active orders** list with status dots (green = all CNF, amber = pending)
- **Archive** — finished orders stored permanently
- **Offline support** — works without internet after first load
- **Persistent storage** — data saved in localStorage, survives restarts

---

## Updating the app

When you get an updated `index.html`:
1. Upload it to your GitHub repo (same steps as above)
2. GitHub Pages updates within ~60 seconds
3. On your phone, open the app and pull to refresh — it will update automatically

---

## Notes

- Data is stored locally on your phone (localStorage) — it does NOT sync between devices
- Clearing browser data / app storage will erase order history — treat it like a local database
- The app works fully offline after the first load (service worker caches everything)
