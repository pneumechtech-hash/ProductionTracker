// Follow-up requests: bulk time without overlaps, telling split groups apart,
// weekend-free "Last 7 days", session sort, and long session lists.
const { test, expect, MIN, at, order, session, openApp, readDB, card, openOrder } = require('./helpers');

const overlaps = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration;

test('bulk +time gives each selected order its own slot — no overlaps', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T14:00',
    settings: { goalMin: 450, lunchStart: '12:00', lunchDur: 30, dayEnd: '16:00' },
    orders: [
      order('PO-1', { created: at('2026-10-21T07:00') }),
      order('PO-2', { created: at('2026-10-21T07:01') }),
      order('PO-3', { created: at('2026-10-21T07:02') }),
      // Busy from 13:00 to 13:50 — the new time has to go around it
      order('PO-BUSY', { created: at('2026-10-21T07:03'), sessions: [session('2026-10-21T13:00', 50)] }),
    ],
  });
  await page.click('#orders-select-btn');
  for (const po of ['PO-1', 'PO-2', 'PO-3']) await card(page, po).click();
  await page.locator('#multiselect-bar').getByRole('button', { name: '+15m' }).click();
  await expect(page.locator('#ms-adj-label')).toContainText('placed one after another');
  await page.click('#ms-adj-commit');

  const db = await readDB(page);
  const added = ['PO-1', 'PO-2', 'PO-3'].map(po => db.orders.find(o => o.po === po).sessions[0]);
  const busy = db.orders.find(o => o.po === 'PO-BUSY').sessions[0];
  for (const s of added) {
    expect(s.duration).toBe(15 * MIN);
    expect(overlaps(s, busy)).toBe(false);
    expect(s.start + s.duration).toBeLessThanOrEqual(at('2026-10-21T14:00') + 1000);
  }
  for (let i = 0; i < added.length; i++) for (let j = i + 1; j < added.length; j++) expect(overlaps(added[i], added[j])).toBe(false);
  // 13:50–14:00 is too short, so: PO-3 12:45–13:00, PO-2 12:30–12:45, and lunch is skipped → PO-1 11:45–12:00
  expect(added.map(s => new Date(s.start).toTimeString().slice(0, 5))).toEqual(['11:45', '12:30', '12:45']);
});

test('bulk +time says so when there is no room left today', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T08:10',
    orders: [order('PO-1'), order('PO-2'), order('PO-X', { sessions: [session('2026-10-21T00:00', 8 * 60)] })],
  });
  await page.click('#orders-select-btn');
  await card(page, 'PO-1').click();
  await card(page, 'PO-2').click();
  await page.locator('#multiselect-bar').getByRole('button', { name: '+15m' }).click();
  await page.click('#ms-adj-commit');
  await expect(page.locator('#ms-adj-label')).toHaveText('Not enough free time today for 2 × 15 min');
  expect((await readDB(page)).orders.find(o => o.po === 'PO-1').sessions).toHaveLength(0);
});

test('split groups get their own letter and colour, stay together, and can be filtered', async ({ page }) => {
  const a = 1700000000000, b = 1700000005000; // group A is the older one
  await openApp(page, {
    orders: [
      order('A-1', { created: at('2026-10-20T08:00'), splitGroupId: a }),
      order('SOLO', { created: at('2026-10-20T09:00') }),
      order('B-1', { created: at('2026-10-20T10:00'), splitGroupId: b }),
      order('A-2', { created: at('2026-10-20T11:00'), splitGroupId: a }),
      order('B-2', { created: at('2026-10-20T12:00'), splitGroupId: b }),
    ],
  });
  // Labels are assigned to existing groups on load
  const db = await readDB(page);
  expect(Object.fromEntries(db.orders.map(o => [o.po, o.splitLabel || null]))).toEqual({ 'A-1': 'A', 'A-2': 'A', 'B-1': 'B', 'B-2': 'B', SOLO: null });

  // Newest first, but each group's members sit together
  expect(await page.locator('#orders-list .order-po').allTextContents()).toEqual(['B-2', 'B-1', 'A-2', 'A-1', 'SOLO']);
  await expect(card(page, 'A-1').locator('.split-badge')).toHaveText('⑂ Split A · 2');
  await expect(card(page, 'B-1').locator('.split-badge')).toHaveText('⑂ Split B · 2');
  const borderA = await card(page, 'A-1').evaluate(el => getComputedStyle(el).borderLeftColor);
  const borderB = await card(page, 'B-1').evaluate(el => getComputedStyle(el).borderLeftColor);
  expect(borderA).not.toBe(borderB);

  await page.locator('#orders-filter-chips [data-group="B"]').click();
  expect(await page.locator('#orders-list .order-po').allTextContents()).toEqual(['B-2', 'B-1']);
  await page.locator('#orders-filter-chips [data-group="B"]').click();

  // Detail lists the rest of the group and can jump between them
  await openOrder(page, 'A-1');
  await expect(page.locator('.detail-group-title')).toHaveText('⑂ Split group A · 2 orders');
  await page.locator('.detail-group-po', { hasText: 'A-2' }).click();
  await expect(page.locator('#modal-detail-title')).toHaveText('A-2');

  // Resuming the group shows its letter on the timer
  await page.click('#detail-group-btn');
  await expect(page.locator('#timer-po-label')).toHaveText('⑂ Split A — 2 Orders');
});

test('a new split group gets the next free letter', async ({ page }) => {
  await openApp(page, { orders: [order('A-1', { splitGroupId: 1 }), order('A-2', { splitGroupId: 1 })] });
  await page.click('#tab-new');
  await page.click('#opt-split');
  for (const po of ['N-1', 'N-2']) { await page.fill('#manual-po', po); await page.press('#manual-po', 'Enter'); }
  await page.click('#split-next-btn');
  await page.click('#details-save-btn');
  const db = await readDB(page);
  expect(db.orders.filter(o => o.po.startsWith('N-')).map(o => o.splitLabel)).toEqual(['B', 'B']);
});

test('"Last 7 days" hides weekend days with nothing logged', async ({ page }) => {
  // Wed Oct 21. Window: Thu 15 … Wed 21 → Sat 17 (empty) is hidden, Sun 18 (worked) is shown
  await openApp(page, { now: '2026-10-21T10:00', orders: [order('PO-1', { sessions: [session('2026-10-18T09:00', 60), session('2026-10-20T09:00', 30)] })] });
  await page.click('#tab-stats');
  const days = page.locator('#stat-daily-breakdown > div > div > span:first-child');
  await expect(days).toHaveText(['Today', 'Tue, Oct 20', 'Mon, Oct 19', 'Sun, Oct 18', 'Fri, Oct 16', 'Thu, Oct 15']);
});

test('session order can be flipped and is remembered', async ({ page }) => {
  await openApp(page, { orders: [order('PO-1', { sessions: [session('2026-10-19T09:00', 10), session('2026-10-20T09:00', 20), session('2026-10-18T09:00', 30)] })] });
  await openOrder(page, 'PO-1');
  const dates = page.locator('#modal-detail .session-date');
  await expect(dates.first()).toContainText('Oct 18');
  await expect(page.locator('#detail-sort-btn')).toHaveText('Oldest first ↑');
  await page.click('#detail-sort-btn');
  await expect(page.locator('#detail-sort-btn')).toHaveText('Newest first ↓');
  await expect(dates.first()).toContainText('Oct 20');
  await expect(dates.last()).toContainText('Oct 18');

  await page.reload();
  await openOrder(page, 'PO-1');
  await expect(dates.first()).toContainText('Oct 20');
});

test('long session lists collapse and the main buttons stay on screen', async ({ page }) => {
  const sessions = Array.from({ length: 12 }, (_, i) => session(`2026-10-${String(8 + i).padStart(2, '0')}T09:00`, 30));
  await openApp(page, { orders: [order('PO-LONG', { sessions })] });
  await openOrder(page, 'PO-LONG');

  await expect(page.locator('#modal-detail .session-item')).toHaveCount(5);
  await expect(page.locator('#detail-show-all')).toContainText('Showing latest 5 of 12');
  // The latest five are the ones shown (Oct 15–19), still oldest first
  await expect(page.locator('#modal-detail .session-date').first()).toContainText('Oct 15');

  await page.click('#detail-show-all');
  await expect(page.locator('#modal-detail .session-item')).toHaveCount(12);

  // Even scrolled to the top of a long sheet, Start / Finish are visible
  await page.locator('#modal-detail .modal').evaluate(el => { el.scrollTop = 0; });
  const vh = page.viewportSize().height;
  for (const id of ['#detail-start-btn', '#detail-finish-btn']) {
    const box = await page.locator(id).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    await expect(page.locator(id)).toBeInViewport();
  }
  // Actions inside the expanded list still work (CNF on the oldest session)
  await page.locator('#modal-detail .session-item').first().getByRole('button', { name: 'CNF' }).click();
  await expect(page.locator('#modal-detail .session-item')).toHaveCount(12); // stays expanded
  expect((await readDB(page)).orders[0].sessions[0].cnf).toBe(true);

  // Closing resets to collapsed
  await page.locator('#modal-detail .modal-close').click();
  await openOrder(page, 'PO-LONG');
  await expect(page.locator('#modal-detail .session-item')).toHaveCount(5);
});
