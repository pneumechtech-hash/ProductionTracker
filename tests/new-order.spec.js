// Entering orders: the "+ New" flow (PO first, then details), duplicate
// detection, and split-time orders.
const { test, expect, MIN, at, order, session, openApp, readDB, card, enterPO, createOrder } = require('./helpers');

test('creates an order with tags and notes without starting a timer', async ({ page }) => {
  await openApp(page);
  await createOrder(page, 'PO-1001', { tags: ['Gantry', 'Kit'], notes: 'Left bay' });

  await expect(page.locator('#view-orders')).toBeVisible();
  const c = card(page, 'PO-1001');
  await expect(c).toBeVisible();
  await expect(c.locator('.order-tag')).toHaveText(['Gantry', 'Kit']);
  await expect(c).toContainText('0 sessions');

  const db = await readDB(page);
  expect(db.orders).toHaveLength(1);
  expect(db.orders[0]).toMatchObject({ po: 'PO-1001', tags: ['Gantry', 'Kit'], notes: 'Left bay', sessions: [] });

  // Survives a reload
  await page.reload();
  await expect(card(page, 'PO-1001')).toBeVisible();
});

test('starts a timer for a new order and saves the session with CNF', async ({ page }) => {
  await openApp(page);
  await createOrder(page, 'PO-2001', { start: true });

  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText('PO-2001');
  await expect(page.locator('#floating-timer')).not.toHaveClass(/show/);

  await page.clock.fastForward('25:00');
  await expect(page.locator('#timer-display')).toHaveText(/^00:25:0\d$/);

  await page.click('#timer-stop-btn');
  await expect(page.locator('#modal-stop')).toHaveClass(/open/);
  await page.click('#stop-save-cnf-btn');

  // Lands on the order detail with the new session
  await expect(page.locator('#modal-detail')).toHaveClass(/open/);
  await expect(page.locator('#modal-detail .session-item')).toHaveCount(1);
  await expect(page.locator('#modal-detail .cnf-badge')).toHaveText('CNF');

  const db = await readDB(page);
  expect(db.orders[0].sessions).toHaveLength(1);
  expect(Math.round(db.orders[0].sessions[0].duration / MIN)).toBe(25);
  expect(db.orders[0].sessions[0].cnf).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('po-tracker-timer-v1'))).toBeNull();
});

test('custom tags can be added and removed — including ones with apostrophes', async ({ page }) => {
  await openApp(page);
  await enterPO(page, 'PO-3001');
  await page.fill('#custom-tag-input', "Bob's line");
  await page.press('#custom-tag-input', 'Enter');
  await page.fill('#custom-tag-input', 'Rework');
  await page.click('#step-details .tag-add-row button');
  await expect(page.locator('#tags-grid .tag.custom')).toHaveCount(2);

  // Remove a custom tag (this click did nothing before the fix)
  await page.locator('#tags-grid .tag.custom', { hasText: 'Rework' }).click();
  await expect(page.locator('#tags-grid .tag.custom')).toHaveCount(1);

  // Standard tags toggle on and off
  await page.locator('#tags-grid .tag', { hasText: 'Testing' }).click();
  await expect(page.locator('#tags-grid .tag', { hasText: 'Testing' })).toHaveClass(/selected/);

  await page.click('#details-save-btn');
  const db = await readDB(page);
  expect(db.orders[0].tags).toEqual(["Bob's line", 'Testing']);
  await expect(card(page, 'PO-3001').locator('.order-tag')).toHaveText(["Bob's line", 'Testing']);
});

test('tag names are shown as text, never as HTML', async ({ page }) => {
  await openApp(page, { orders: [order('PO-X', { tags: ['<img src=x onerror="window.__xss=1">'] })] });
  await expect(card(page, 'PO-X').locator('.order-tag')).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('entering a PO that is already active offers to reuse it instead of duplicating', async ({ page }) => {
  await openApp(page, { orders: [order('PO-4001', { sessions: [session('2026-10-20T08:00', 30)] })] });
  await enterPO(page, 'po-4001 '); // different case + stray space still matches

  const notice = page.locator('#po-match-notice .po-notice');
  await expect(notice).toContainText('PO-4001 is already an active order');
  await expect(page.locator('#step-details')).toBeHidden();

  await notice.getByRole('button', { name: /Start timer on it/ }).click();
  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText('PO-4001');

  const db = await readDB(page);
  expect(db.orders).toHaveLength(1); // no duplicate created
});

test('"New anyway" still allows a second order with the same PO', async ({ page }) => {
  await openApp(page, { orders: [order('PO-4002')] });
  await enterPO(page, 'PO-4002');
  await page.getByRole('button', { name: 'New anyway' }).click();
  await page.click('#details-save-btn');
  expect((await readDB(page)).orders).toHaveLength(2);
});

test('entering an archived PO offers to reopen it', async ({ page }) => {
  await openApp(page, { archive: [order('PO-5001', { finishedAt: at('2026-10-19T15:00'), sessions: [session('2026-10-19T09:00', 60, { cnf: true })] })] });
  await enterPO(page, 'PO-5001');
  await expect(page.locator('#po-match-notice')).toContainText('is in the archive');
  await page.getByRole('button', { name: '↩ Reopen it' }).click();

  await expect(page.locator('#modal-detail')).toHaveClass(/open/);
  const db = await readDB(page);
  expect(db.archive).toHaveLength(0);
  expect(db.orders.map(o => o.po)).toEqual(['PO-5001']);
  expect(db.orders[0].finished).toBe(false);
});

test('split time weights the session by quantity', async ({ page }) => {
  await openApp(page);
  await page.click('#tab-new');
  await page.click('#opt-split');
  for (const po of ['PO-A', 'PO-B']) {
    await page.fill('#manual-po', po);
    await page.press('#manual-po', 'Enter');
  }
  // Duplicate entries are rejected with feedback
  await page.fill('#manual-po', 'po-a');
  await page.press('#manual-po', 'Enter');
  await expect(page.locator('#scan-status')).toHaveText('po-a is already in the list');
  await expect(page.locator('.split-po-item')).toHaveCount(2);

  const qty = page.locator('.split-qty-input');
  await qty.nth(0).fill('1');
  await expect(page.locator('#split-hint')).toContainText('QTY missing on 1 PO');
  await qty.nth(1).fill('3');
  await expect(page.locator('#split-hint')).toHaveText('Time will be weighted by quantity.');

  await page.click('#split-next-btn');
  await expect(page.locator('#details-po-label')).toHaveText('Split Time — 2 Orders');
  await page.locator('#tags-grid .tag', { hasText: 'Kit' }).click();
  await page.click('#details-start-btn');
  await expect(page.locator('#timer-po-label')).toHaveText('⑂ Split A — 2 Orders');

  await page.clock.fastForward('40:00');
  await page.click('#timer-stop-btn');
  await expect(page.locator('#stop-split-info')).toContainText('Qty-weighted split');
  await page.click('#stop-save-btn');

  const db = await readDB(page);
  const byPO = Object.fromEntries(db.orders.map(o => [o.po, o]));
  expect(Math.round(byPO['PO-A'].sessions[0].duration / MIN)).toBe(10);
  expect(Math.round(byPO['PO-B'].sessions[0].duration / MIN)).toBe(30);
  expect(byPO['PO-A'].tags).toEqual(['Kit']);
  expect(byPO['PO-A'].splitGroupId).toBe(byPO['PO-B'].splitGroupId);
  // Sessions sit back-to-back and add up to the whole elapsed time
  const a = byPO['PO-A'].sessions[0], b = byPO['PO-B'].sessions[0];
  expect(Math.abs(a.start + a.duration - b.start) < 5 || Math.abs(b.start + b.duration - a.start) < 5).toBe(true);
});

test('split time with a missing quantity splits evenly instead of giving an order zero', async ({ page }) => {
  await openApp(page);
  await page.click('#tab-new');
  await page.click('#opt-split');
  for (const po of ['PO-C', 'PO-D']) {
    await page.fill('#manual-po', po);
    await page.click('#manual-po-btn');
  }
  await page.locator('.split-qty-input').nth(0).fill('5');
  await page.click('#split-next-btn');
  await page.click('#details-start-btn');
  await page.clock.fastForward('20:00');
  await page.click('#timer-stop-btn');
  await expect(page.locator('#stop-split-info')).toContainText('÷ 2 orders');
  await page.click('#stop-save-btn');

  const db = await readDB(page);
  for (const o of db.orders) expect(Math.round(o.sessions[0].duration / MIN)).toBe(10);
});

test('split time adds to an order that already exists', async ({ page }) => {
  await openApp(page, { orders: [order('PO-E', { sessions: [session('2026-10-20T08:00', 15)] })] });
  await page.click('#tab-new');
  await page.click('#opt-split');
  for (const po of ['PO-E', 'PO-F']) {
    await page.fill('#manual-po', po);
    await page.press('#manual-po', 'Enter');
  }
  await expect(page.locator('.split-po-note')).toHaveCount(1);
  await page.click('#split-next-btn');
  await page.click('#details-start-btn');
  await page.clock.fastForward('10:00');
  await page.click('#timer-stop-btn');
  await page.click('#stop-save-btn');

  const db = await readDB(page);
  expect(db.orders.map(o => o.po).sort()).toEqual(['PO-E', 'PO-F']);
  expect(db.orders.find(o => o.po === 'PO-E').sessions).toHaveLength(2);
});

test('back from details keeps the draft tags', async ({ page }) => {
  await openApp(page);
  await enterPO(page, 'PO-6001');
  await page.locator('#tags-grid .tag', { hasText: 'Gantry' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('#step-po')).toBeVisible();
  await page.press('#manual-po', 'Enter');
  await expect(page.locator('#tags-grid .tag', { hasText: 'Gantry' })).toHaveClass(/selected/);
});
