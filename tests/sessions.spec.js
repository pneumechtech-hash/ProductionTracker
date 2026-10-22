// Editing an order's time: manual sessions, quick add, deductions, deletes, CNF.
const { test, expect, MIN, at, order, session, openApp, readDB, openOrder } = require('./helpers');

async function openManualForm(page, po) {
  await openOrder(page, po);
  await page.locator('#modal-detail').getByText('Manual Session').click();
  await expect(page.locator('[id^=manual-add-form-]')).toBeVisible();
}

test('manual session date defaults to the local date, even late in the evening', async ({ page }) => {
  // 21:30 in Toronto is already the next day in UTC
  await openApp(page, { now: '2026-10-21T21:30', orders: [order('PO-A')] });
  await openManualForm(page, 'PO-A');
  await expect(page.locator('[id^=add-date-]')).toHaveValue('2026-10-21');
});

test('adds a manual session by start + duration and by start + end', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T15:00', orders: [order('PO-A')] });
  await openManualForm(page, 'PO-A');
  await page.locator('[id^=add-start-]').fill('08:00');
  await page.locator('input[id^=add-dur-]').fill('30');
  await page.locator('#modal-detail').getByRole('button', { name: '+ Add Session' }).click();
  await expect(page.locator('#modal-detail .adj-badge')).toHaveText('MANUAL');

  await page.locator('#modal-detail').getByText('Manual Session').click();
  await page.locator('[id^=add-mode-end-]').click();
  await page.locator('[id^=add-date-]').fill('2026-10-20');
  await page.locator('[id^=add-start-]').fill('13:00');
  await page.locator('[id^=add-end-]').fill('14:15');
  await page.locator('#modal-detail').getByRole('button', { name: '+ Add Session' }).click();

  const sessions = (await readDB(page)).orders[0].sessions;
  expect(sessions.map(s => [s.start, s.duration / MIN, s.manual, s.cnf])).toEqual([
    [at('2026-10-21T08:00'), 30, true, false],
    [at('2026-10-20T13:00'), 75, true, false],
  ]);
  // Listed oldest first
  await expect(page.locator('#modal-detail .session-date').first()).toContainText('Oct 20');
});

test('manual sessions are blocked when they overlap other work or the configured lunch', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T15:00',
    orders: [order('PO-A')],
    archive: [order('PO-DONE', { finishedAt: at('2026-10-21T10:00'), sessions: [session('2026-10-21T09:00', 60, { cnf: true })] })],
    settings: { goalMin: 450, lunchStart: '11:30', lunchDur: 30, dayEnd: '16:00' },
  });
  await openManualForm(page, 'PO-A');
  const err = page.locator('[id^=add-error-]');
  await page.locator('[id^=add-start-]').fill('09:30');
  await page.locator('input[id^=add-dur-]').fill('10');
  await expect(err).toContainText('Overlaps with PO-DONE'); // finished orders' time counts too

  await page.locator('[id^=add-start-]').fill('11:40');
  await expect(err).toHaveText(/Overlaps with lunch break \(11:30.*12:00/);

  await page.locator('[id^=add-start-]').fill('16:00');
  await expect(err).toHaveText('Start time must be in the past.');

  await page.locator('[id^=add-start-]').fill('13:00');
  await expect(err).toHaveText('');
});

test('quick add: "Since last" fills the gap after the most recent session', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T09:40',
    orders: [order('PO-A', { sessions: [session('2026-10-21T08:00', 60)] }), order('PO-B')],
  });
  await openOrder(page, 'PO-B');
  await page.getByRole('button', { name: 'Since last' }).click();
  await expect(page.locator('[id^=quick-add-label-]')).toHaveText(/09:00.*09:40.* · 40 min/);
  await page.getByRole('button', { name: '+5 min' }).click(); // extends earlier — overlaps PO-A
  await expect(page.locator('[id^=quick-add-error-]')).toContainText('Overlaps with PO-A');
  await page.getByRole('button', { name: 'Add Session', exact: true }).click();
  const b = (await readDB(page)).orders.find(o => o.po === 'PO-B');
  expect(b.sessions).toHaveLength(1);
  expect(b.sessions[0].start).toBe(at('2026-10-21T09:00'));
  expect(Math.round(b.sessions[0].duration / MIN)).toBe(40);
});

test('deduct time from a session and undo it', async ({ page }) => {
  await openApp(page, { orders: [order('PO-A', { sessions: [session('2026-10-20T08:00', 60)] })] });
  await openOrder(page, 'PO-A');
  await page.getByRole('button', { name: 'Remove time from this session' }).click();
  await page.locator('[id^=deduct-mins-]').fill('15');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#modal-detail .total-bar')).toContainText('45 min');
  await page.getByRole('button', { name: '↩ Undo' }).click();
  await expect(page.locator('#modal-detail .total-bar')).toContainText('60 min');
  expect((await readDB(page)).orders[0].sessions[0].deductions).toEqual([]);
});

test('press and hold a session to delete it', async ({ page }) => {
  await openApp(page, { orders: [order('PO-A', { sessions: [session('2026-10-20T08:00', 60), session('2026-10-20T10:00', 30)] })] });
  await openOrder(page, 'PO-A');
  const first = page.locator('#modal-detail .session-item').first();
  const box = await first.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 15);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.mouse.up();
  await page.locator('[id^=session-delete-]').getByRole('button', { name: 'Delete' }).click();
  const sessions = (await readDB(page)).orders[0].sessions;
  expect(sessions).toHaveLength(1);
  expect(sessions[0].start).toBe(at('2026-10-20T10:00'));
});

test('CNF one session, then CNF all', async ({ page }) => {
  await openApp(page, { orders: [order('PO-A', { sessions: [session('2026-10-20T08:00', 60), session('2026-10-20T10:00', 30), session('2026-10-20T11:00', 15)] })] });
  await openOrder(page, 'PO-A');
  await page.locator('#modal-detail .session-item').first().getByRole('button', { name: 'CNF' }).click();
  await expect(page.locator('#detail-cnf-all')).toHaveText('CNF All (2)');
  await page.click('#detail-cnf-all');
  await expect(page.locator('#detail-cnf-all')).toHaveCount(0);
  expect((await readDB(page)).orders[0].sessions.every(s => s.cnf)).toBe(true);
});
