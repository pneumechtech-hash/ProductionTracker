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

## How it works

**Entering an order** — tap **+ New**, scan the barcode or type the PO, then pick tags / add notes and tap **▶ Start Timer** (or **Save Without Timer**).
- If the PO is already active you're offered **Start timer on it** / **Open order** instead of creating a duplicate; if it's archived you can **Reopen it**.
- **Split Time** mode times several POs at once. Enter a QTY on every PO to weight the time by quantity, otherwise it is split evenly. POs that already exist get the time added to them.

**Tracking time**
- Only one timer runs at a time. Starting another (or finishing the order being timed) first asks you to save the running session — time is never silently dropped.
- While you browse other tabs a bar at the top shows the running timer; tap it to get back.
- Pause / resume, and shift the start time with −15m … +15m.
- The timer pauses itself at lunch and at the end-of-day time (both set in ⚙ Settings), once per day. If the phone was asleep, it pauses at the alert time when you reopen the app.
- In an order you can add time afterwards (**Quick Add**, **Manual Session**), remove time from a session (✎), CNF sessions, or press and hold a session to delete it.

**Organizing**
- Orders list: search (PO, tag or notes; `*` wildcards work on PO/tags), ★ favorites, ⚠ unconfirmed, tag filter chips, and sort (newest, last worked, oldest, PO #, most time). Favorites and the order being timed stay at the top.
- **Select** (or press and hold a card) for bulk CNF, finish, split timer, or ± time.
- Order detail: edit PO number, notes and tags; mark finished; delete.
- **Timeline** shows a day's sessions; ‹ › moves between days.
- **Archive** holds finished orders: reopen or (with confirmation) delete them.

**Your data** lives only on the device (localStorage). In ⚙ Settings → Backup & Restore you can export CSV (for spreadsheets / SAP entry) or a JSON backup, and restore a JSON backup.

---

## Updating the app

When you get an updated `index.html`:
1. Upload it to your GitHub repo (same steps as above)
2. GitHub Pages updates within ~60 seconds
3. On your phone, open the app and pull to refresh — it will update automatically

---

## Notes

- Data is stored locally on your phone (localStorage) — it does NOT sync between devices
- Clearing browser data / app storage will erase order history — export a JSON backup regularly (⚙ Settings)
- The app works fully offline after the first load (service worker caches everything)
- When you change `index.html`, bump `APP_VERSION` in it and `CACHE` in `sw.js` together

---

## Development & tests

Only `index.html`, `manifest.json`, `sw.js` and `icons/` are needed for deployment. The rest is for testing.

```bash
npm install                      # once — installs Playwright
npx playwright install chromium  # once — downloads the test browser
npm run serve                    # run locally at http://localhost:4173/
npm test                         # run the end-to-end tests
```

The tests live in `tests/` and drive the real app in a phone-sized Chromium window with a fake clock, so timer, lunch and end-of-day behaviour can be tested without waiting.
