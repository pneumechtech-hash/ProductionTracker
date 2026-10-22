// Shared fixtures and helpers for the PO Tracker end-to-end tests.
const { test: base, expect } = require('@playwright/test');

const MIN = 60000;

// Local-time timestamp (TZ is pinned in playwright.config.js)
const at = s => new Date(s).getTime();

let seq = 1;
// Builds an order record the way the app stores it.
function order(po, { tags = [], notes = '', sessions = [], created = at('2026-10-20T08:00'), favorite, finishedAt, splitGroupId, splitQty } = {}) {
  const o = { id: 1e15 + seq++, po, tags, notes, sessions, created, finished: !!finishedAt };
  if (favorite) o.favorite = true;
  if (finishedAt) o.finishedAt = finishedAt;
  if (splitGroupId) o.splitGroupId = splitGroupId;
  if (splitQty) o.splitQty = splitQty;
  return o;
}
// A worked session starting at local time `start` lasting `min` minutes.
function session(start, min, { cnf = false, manual } = {}) {
  const s = { start: at(start), duration: min * MIN, cnf, date: at(start) };
  if (manual) s.manual = true;
  return s;
}

const test = base.extend({
  page: async ({ page }, use) => {
    // The barcode library comes from a CDN; tests use manual entry.
    await page.route(/cdn\.jsdelivr\.net/, route => route.abort());
    const errors = [];
    page.on('pageerror', e => errors.push(e));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

/**
 * Opens the app with a fake clock and optional seeded storage. Seeding only
 * happens on the first load, so page.reload() keeps whatever the app saved.
 */
async function openApp(page, { now = '2026-10-21T09:00', orders = [], archive = [], settings, timer, raw } = {}) {
  await page.clock.install({ time: at(now) });
  await page.addInitScript(([orders, archive, settings, timer, raw]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('install-dismissed', '1');
    localStorage.setItem('po-tracker-v1', raw || JSON.stringify({ orders, archive }));
    if (settings) localStorage.setItem('po-tracker-settings-v1', JSON.stringify(settings));
    if (timer) localStorage.setItem('po-tracker-timer-v1', JSON.stringify(timer));
  }, [orders, archive, settings, timer, raw]);
  await page.goto('/');
}

const readDB = page => page.evaluate(() => JSON.parse(localStorage.getItem('po-tracker-v1')));
const readTimer = page => page.evaluate(() => JSON.parse(localStorage.getItem('po-tracker-timer-v1')));

const card = (page, po) => page.locator('#orders-list .order-card', { has: page.locator('.order-po', { hasText: new RegExp(`^${po}$`) }) });
const archiveCard = (page, po) => page.locator('#archive-list .order-card', { has: page.locator('.order-po', { hasText: new RegExp(`^${po}$`) }) });

// Goes through "+ New" → enter PO → (optional tags/notes) → details step.
async function enterPO(page, po) {
  await page.click('#tab-new');
  await page.fill('#manual-po', po);
  await page.press('#manual-po', 'Enter');
}

async function createOrder(page, po, { tags = [], notes = '', start = false } = {}) {
  await enterPO(page, po);
  await expect(page.locator('#step-details')).toBeVisible();
  for (const t of tags) await page.locator('#tags-grid .tag', { hasText: t }).click();
  if (notes) await page.fill('#new-notes', notes);
  await page.click(start ? '#details-start-btn' : '#details-save-btn');
}

async function openOrder(page, po) {
  if (!(await page.locator('#view-orders').isVisible())) await page.click('#tab-orders');
  await card(page, po).click();
  await expect(page.locator('#modal-detail')).toHaveClass(/open/);
}

module.exports = { test, expect, MIN, at, order, session, openApp, readDB, readTimer, card, archiveCard, enterPO, createOrder, openOrder };
