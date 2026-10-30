// Pinned filter chips, monthly goal, transfer time, find time.
const { test, expect, MIN, at, order, session, openApp, readDB, card, openOrder } = require('./helpers');

const SETTINGS = { goalMin: 450, lunchStart: '12:00', lunchDur: 30, dayEnd: '16:00' };
const openSettings = async page => {
  await page.click('.gear-btn');
  await expect(page.locator('#modal-settings')).toHaveClass(/open/);
};
const chipTexts = page => page.locator('#orders-filter-chips > .filter-chip').allTextContents();

// ── Filter chips ─────────────────────────────────────────────────────────────
test('only pinned chips show; the rest are under "More", and pins are set in Settings', async ({ page }) => {
  await openApp(page, { orders: [order('PO-1', { tags: ['Kit', 'Gantry'] }), order('PO-2', { tags: ['Kit'] })] });
  expect(await chipTexts(page)).toEqual(['★ Favorites', '⚠ Unconfirmed', 'More · 2 ▾']);

  // "More" opens the rest; picking one filters, closes the panel, and keeps the active chip visible
  await page.click('#chip-more');
  await expect(page.locator('#chip-overflow .tag-chip')).toHaveText(['Gantry', 'Kit']);
  await page.locator('#chip-overflow .tag-chip', { hasText: 'Gantry' }).click();
  await expect(page.locator('#chip-overflow')).toHaveCount(0);
  expect(await page.locator('#orders-list .order-po').allTextContents()).toEqual(['PO-1']);
  expect(await chipTexts(page)).toEqual(['★ Favorites', '⚠ Unconfirmed', 'Gantry', 'More · 1 ▾']);
  await page.locator('#orders-filter-chips > .tag-chip', { hasText: 'Gantry' }).click(); // switch it off
  expect(await page.locator('#orders-list .order-po').allTextContents()).toHaveLength(2);

  // Pin Kit, unpin Unconfirmed
  await openSettings(page);
  await page.locator('#settings-chip-pins [data-key="tag:Kit"]').click();
  await page.locator('#settings-chip-pins [data-key="unconfirmed"]').click();
  await page.click('#settings-save-btn');
  expect(await chipTexts(page)).toEqual(['★ Favorites', 'Kit', 'More · 2 ▾']);

  await page.reload();
  expect(await chipTexts(page)).toEqual(['★ Favorites', 'Kit', 'More · 2 ▾']);
});

test('closing Settings without saving leaves the pins unchanged', async ({ page }) => {
  await openApp(page, { orders: [order('PO-1', { tags: ['Kit'] })] });
  await openSettings(page);
  await page.locator('#settings-chip-pins [data-key="tag:Kit"]').click();
  await page.locator('#modal-settings .modal-close').click();
  expect(await chipTexts(page)).toEqual(['★ Favorites', '⚠ Unconfirmed', 'More · 1 ▾']);
});

// ── Monthly goal ─────────────────────────────────────────────────────────────
test('monthly goal shows hours, percent left and the pace needed', async ({ page }) => {
  // Wed Oct 21: Oct 21–30 has 8 Mon–Fri work days left (incl. today)
  await openApp(page, {
    now: '2026-10-21T10:00',
    settings: { ...SETTINGS, monthGoalHours: 100 },
    orders: [order('PO-1', { sessions: [session('2026-10-05T08:00', 1200), session('2026-10-20T08:00', 600), session('2026-09-30T08:00', 600)] })],
  });
  await page.click('#tab-stats');
  await expect(page.locator('#stat-month-label')).toHaveText('This Month — October');
  await expect(page.locator('#stat-month-hours')).toHaveText('30.0 h'); // September time excluded
  await expect(page.locator('#stat-month-left')).toHaveText('70%');
  await expect(page.locator('#stat-month-pct')).toHaveText('30%');
  await expect(page.locator('#stat-month-detail')).toHaveText('70.0 h to go · 8 work days left · ≈ 8.8 h/day');
});

test('monthly goal is off until set in Settings, which suggests a figure', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T10:00' });
  await page.click('#tab-stats');
  await expect(page.locator('#stat-month')).toContainText('Logged this month');
  await page.locator('#stat-month').getByRole('button', { name: 'Set a monthly goal' }).click();
  // October 2026 has 22 Mon–Fri days × 450 min = 165 h
  await expect(page.locator('#settings-month-hint')).toHaveText('0 = off · this month: 22 work days × daily goal ≈ 165 h');
  await page.fill('#settings-month-goal', '160');
  await page.click('#settings-save-btn');
  await expect(page.locator('#stat-month-left')).toHaveText('100%');
});

test('goal reached shows a tick and the hours over', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T10:00', settings: { ...SETTINGS, monthGoalHours: 10 }, orders: [order('PO-1', { sessions: [session('2026-10-05T08:00', 720)] })] });
  await page.click('#tab-stats');
  await expect(page.locator('#stat-month-left')).toHaveText('✓');
  await expect(page.locator('#stat-month-detail')).toHaveText('2.0 h over goal');
});

// ── Transfer time ────────────────────────────────────────────────────────────
test('transfer moves the last minutes of the source onto the target, same clock time', async ({ page }) => {
  await openApp(page, {
    orders: [
      order('PO-SRC', { sessions: [session('2026-10-20T08:00', 60, { cnf: true }), session('2026-10-20T10:00', 20)] }),
      order('PO-DST'),
    ],
  });
  await openOrder(page, 'PO-SRC');
  await page.click('#detail-transfer-btn');
  await expect(page.locator('#modal-transfer')).toHaveClass(/open/);
  await page.fill('#transfer-min', '30');
  await page.selectOption('#transfer-to', { label: 'PO-DST' });
  // 20 min from the 10:00 session, then 10 min from the end of the 08:00 one (which was CNF'd)
  await expect(page.locator('#transfer-preview')).toContainText('30 min from PO-SRC → PO-DST');
  await expect(page.locator('#transfer-preview')).toContainText('go back to pending');
  await page.click('#transfer-ok');

  const db = await readDB(page);
  const src = db.orders.find(o => o.po === 'PO-SRC');
  const dst = db.orders.find(o => o.po === 'PO-DST');
  expect(src.sessions).toHaveLength(1); // the 20-min session was fully moved
  expect(src.sessions[0]).toMatchObject({ start: at('2026-10-20T08:00'), duration: 50 * MIN, cnf: false });
  expect(src.sessions[0].transfers[0]).toMatchObject({ amount: 10 * MIN, toPO: 'PO-DST' });
  expect(dst.sessions.map(s => [s.start, s.duration / MIN, s.transferFrom, s.cnf]).sort((a, b) => a[0] - b[0])).toEqual([
    [at('2026-10-20T08:50'), 10, 'PO-SRC', false],
    [at('2026-10-20T10:00'), 20, 'PO-SRC', false],
  ]);
  // Source detail shows the history; target shows where the time came from
  await expect(page.locator('#modal-detail')).toContainText('10 min moved to PO-DST');
  await page.locator('#modal-detail .modal-close').click();
  await openOrder(page, 'PO-DST');
  await expect(page.locator('#modal-detail .adj-badge').first()).toHaveText('FROM PO-SRC');
});

test('transfer from one chosen session, and it refuses more than is there', async ({ page }) => {
  await openApp(page, { orders: [order('PO-SRC', { sessions: [session('2026-10-20T08:00', 60), session('2026-10-20T10:00', 20)] }), order('PO-DST')] });
  await openOrder(page, 'PO-SRC');
  await page.click('#detail-transfer-btn');
  await page.selectOption('#transfer-to', { label: 'PO-DST' });
  await page.selectOption('#transfer-src', { index: 2 }); // the 08:00 session (list is latest first)
  await page.fill('#transfer-min', '90');
  await expect(page.locator('#transfer-preview')).toHaveText('Only 60 min available in that session.');
  await expect(page.locator('#transfer-ok')).toBeDisabled();
  await page.fill('#transfer-min', '15');
  await page.click('#transfer-ok');
  const db = await readDB(page);
  const src = db.orders.find(o => o.po === 'PO-SRC');
  expect(src.sessions.map(s => s.duration / MIN)).toEqual([45, 20]);
  expect(db.orders.find(o => o.po === 'PO-DST').sessions[0].start).toBe(at('2026-10-20T08:45'));
});

// ── Find time ────────────────────────────────────────────────────────────────
test('find time fills free gaps inside working hours, newest first, and previews before saving', async ({ page }) => {
  // Wed Oct 21 at 10:00. Working hours 07:00–16:00. Logged today: 07:00–09:30 and 09:40–10:00.
  await openApp(page, {
    now: '2026-10-21T10:00',
    settings: SETTINGS,
    orders: [
      order('PO-BUSY', { sessions: [session('2026-10-21T07:00', 150), session('2026-10-21T09:40', 20)] }),
      order('PO-TARGET'),
    ],
  });
  await openOrder(page, 'PO-TARGET');
  await page.click('#detail-find-btn');
  await expect(page.locator('#modal-find')).toContainText('7:00 a.m.–4:00 p.m., Mon–Fri');
  await page.fill('#find-min', '40');
  // 10 min today (09:30–09:40), then 30 min from the end of yesterday (15:30–16:00)
  await expect(page.locator('#find-preview')).toContainText('PO-TARGET · 40 min');
  await expect(page.locator('#find-preview')).toContainText('Tue, Oct 20 03:30 p.m.–04:00 p.m.');
  await expect(page.locator('#find-preview')).toContainText('Wed, Oct 21 09:30 a.m.–09:40 a.m.');
  expect((await readDB(page)).orders.find(o => o.po === 'PO-TARGET').sessions).toHaveLength(0); // nothing saved yet

  await page.click('#find-ok');
  const s = (await readDB(page)).orders.find(o => o.po === 'PO-TARGET').sessions.sort((a, b) => a.start - b.start);
  expect(s.map(x => [x.start, x.duration / MIN, x.manual])).toEqual([
    [at('2026-10-20T15:30'), 30, true],
    [at('2026-10-21T09:30'), 10, true],
  ]);
});

test('find time skips lunch, days off and slivers; respects custom working hours', async ({ page }) => {
  // Mon Oct 19 at 13:00, working hours 08:00–12:15, lunch 12:00–12:30, Mon–Fri.
  await openApp(page, {
    now: '2026-10-19T13:00',
    settings: { ...SETTINGS, workStart: '08:00', workEnd: '12:15', workDays: [1, 2, 3, 4, 5] },
    orders: [order('PO-BUSY', { sessions: [session('2026-10-19T08:00', 223)] }), order('PO-T')], // busy until 11:43
  });
  await openOrder(page, 'PO-T');
  await page.click('#detail-find-btn');
  await page.fill('#find-min', '20');
  // Today only 11:43–12:00 is free (17 min): lunch runs to 12:30, past the 12:15 finish.
  // The weekend is off, so the last 3 min come from the end of Friday's morning.
  await expect(page.locator('#find-preview')).toContainText('Mon, Oct 19 11:43 a.m.–12:00 p.m.');
  await expect(page.locator('#find-preview')).toContainText('Fri, Oct 16 11:57 a.m.–12:00 p.m.');
  await expect(page.locator('#find-preview')).not.toContainText('Oct 18');
  await expect(page.locator('#find-preview')).not.toContainText('Oct 17');
});

test('find time for several orders: each gets the minutes, or the total is split', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T10:00', settings: SETTINGS, orders: [order('PO-1', { created: at('2026-10-20T08:00') }), order('PO-2', { created: at('2026-10-20T08:01') })] });
  await page.click('#orders-select-btn');
  await card(page, 'PO-1').click();
  await card(page, 'PO-2').click();
  await page.click('#ms-find-btn');
  await page.fill('#find-min', '30');
  await expect(page.locator('#find-ok')).toHaveText('Add 2 sessions');
  await page.click('#find-split');
  await expect(page.locator('#find-preview')).toContainText('PO-1 · 15 min');
  await expect(page.locator('#find-preview')).toContainText('PO-2 · 15 min');
  await page.click('#find-ok');
  await expect(page.locator('#multiselect-bar')).toBeHidden();
  const db = await readDB(page);
  const p1 = db.orders.find(o => o.po === 'PO-1').sessions[0], p2 = db.orders.find(o => o.po === 'PO-2').sessions[0];
  // First-selected gets the earlier slot; no overlap
  expect([p1.start, p1.duration / MIN, p2.start, p2.duration / MIN]).toEqual([at('2026-10-21T09:30'), 15, at('2026-10-21T09:45'), 15]);
});

test('find time says when there isn\'t enough free time', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T08:00', settings: SETTINGS, orders: [order('PO-1')] });
  await openOrder(page, 'PO-1');
  await page.click('#detail-find-btn');
  await page.selectOption('#find-days', '1');
  await page.fill('#find-min', '90');
  await expect(page.locator('#find-preview')).toHaveText(/Only 60 min of 90 min free in working hours/);
  await expect(page.locator('#find-ok')).toBeDisabled();
});

test('work days setting changes which days the timeline steps through', async ({ page }) => {
  // Work Mon–Sat: stepping back from Monday lands on Saturday even without sessions
  await openApp(page, { now: '2026-10-19T10:00', settings: { ...SETTINGS, workDays: [1, 2, 3, 4, 5, 6] }, orders: [order('PO-1', { sessions: [session('2026-10-19T08:00', 30)] })] });
  await page.click('#timeline-toggle-btn');
  await page.click('#tl-prev-btn');
  await expect(page.locator('#tl-day-label')).toHaveText(/^Sat/);
});
