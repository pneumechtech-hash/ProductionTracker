// Tracking time: running, switching, pausing, adjusting and restoring timers,
// plus the lunch / end-of-day auto-pause alerts.
const { test, expect, MIN, at, order, session, openApp, readDB, readTimer, card, openOrder } = require('./helpers');

const twoOrders = () => [order('PO-A', { created: at('2026-10-20T08:00') }), order('PO-B', { created: at('2026-10-20T08:01') })];

async function startOn(page, po) {
  await openOrder(page, po);
  await page.click('#detail-start-btn');
  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText(po);
}

test('starting a second timer asks to save the running one first (no lost time)', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('30:00');

  await openOrder(page, 'PO-B');
  await page.click('#detail-start-btn');
  await expect(page.locator('#modal-stop')).toHaveClass(/open/);
  await expect(page.locator('#stop-modal-title')).toHaveText('Stop Current Timer?');
  await expect(page.locator('#stop-next-info')).toContainText('PO-A is still being timed');
  await page.click('#stop-save-btn');

  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText('PO-B');
  const db = await readDB(page);
  const a = db.orders.find(o => o.po === 'PO-A');
  expect(a.sessions).toHaveLength(1);
  expect(Math.round(a.sessions[0].duration / MIN)).toBe(30);
  expect((await readTimer(page)).activeOrderId).toBe(db.orders.find(o => o.po === 'PO-B').id);
});

test('cancelling the switch keeps the original timer running', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await openOrder(page, 'PO-B');
  await page.click('#detail-start-btn');
  await page.locator('#modal-stop .modal-close').click();

  await expect(page.locator('#floating-timer')).toHaveClass(/show/);
  await expect(page.locator('#ft-po')).toHaveText('PO-A');
  // Closing the modal cleared the pending switch — a later plain stop doesn't start PO-B
  await page.click('#floating-timer');
  await page.click('#timer-stop-btn');
  await page.click('#stop-save-btn');
  await expect(page.locator('#view-orders')).toBeVisible();
  expect(await readTimer(page)).toBeNull();
});

test('finishing an order that is being timed saves the running session first', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('12:00');
  await openOrder(page, 'PO-A');
  await expect(page.locator('#modal-detail')).toContainText('Timer is running on this order');
  await page.getByRole('button', { name: 'Stop & Finish' }).click();
  await expect(page.locator('#stop-next-info')).toContainText('then finish PO-A');
  await page.click('#stop-save-cnf-btn');

  await expect(page.locator('#view-orders')).toBeVisible();
  const db = await readDB(page);
  expect(db.orders.map(o => o.po)).toEqual(['PO-B']);
  expect(db.archive[0].po).toBe('PO-A');
  expect(Math.round(db.archive[0].sessions[0].duration / MIN)).toBe(12);
  expect(db.archive[0].sessions[0].cnf).toBe(true);
});

test('"+ New" works while a timer runs and the floating bar returns to it', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.click('#tab-new');
  await expect(page.locator('#step-po')).toBeVisible();
  await expect(page.locator('#floating-timer')).toHaveClass(/show/);
  await page.click('#floating-timer');
  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText('PO-A');
  await expect(page.locator('.tab.active')).toHaveCount(0); // the timer isn't one of the tabs
});

test('pause excludes the paused time; the floating bar shows the paused state', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('10:00');
  await page.click('#timer-pause-btn');
  await expect(page.locator('#timer-status')).toHaveText('⏸ PAUSED');
  await page.clock.fastForward('20:00');
  await expect(page.locator('#timer-display')).toHaveText(/^00:10:0\d$/);

  await page.click('#tab-orders');
  await expect(page.locator('#floating-timer')).toHaveClass(/paused/);
  await expect(page.locator('#ft-po')).toHaveText('⏸ PO-A');

  await page.click('#floating-timer');
  await page.click('#timer-pause-btn');
  await expect(page.locator('#timer-status')).toHaveText('● RECORDING');
  await page.clock.fastForward('05:00');
  await page.click('#timer-stop-btn');
  await page.click('#stop-save-btn');
  const db = await readDB(page);
  expect(Math.round(db.orders.find(o => o.po === 'PO-A').sessions[0].duration / MIN)).toBe(15);
});

test('start-time adjustments can never make the session negative', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('03:00');
  await page.getByRole('button', { name: '−15m' }).click();
  await expect(page.locator('#timer-display')).toHaveText('00:00:00');
  await page.getByRole('button', { name: '+15m' }).click();
  await page.getByRole('button', { name: '+15m' }).click();
  await expect(page.locator('#timer-adj-amount')).toHaveText('+27m'); // net vs. the real start
  await page.click('#timer-stop-btn');
  await page.click('#stop-save-btn');
  const s = (await readDB(page)).orders.find(o => o.po === 'PO-A').sessions[0];
  expect(Math.round(s.duration / MIN)).toBe(30);
  expect(s.duration).toBeGreaterThan(0);
});

test('adjusting after a pause/resume does not count the pause as an adjustment', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.click('#timer-pause-btn');
  await page.clock.fastForward('10:00');
  await page.click('#timer-pause-btn');
  await page.getByRole('button', { name: '+5m' }).click();
  await expect(page.locator('#timer-adj-amount')).toHaveText('+5m');
});

test('a running timer survives a reload', async ({ page }) => {
  await openApp(page, { orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('07:00');
  await page.reload();
  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#timer-po')).toHaveText('PO-A');
  await expect(page.locator('#timer-display')).toHaveText(/^00:07:\d\d$/);
});

test('timer state pointing at a deleted order is discarded on load', async ({ page }) => {
  await openApp(page, { orders: twoOrders(), timer: { timerStart: at('2026-10-21T08:30'), activeOrderId: 12345, splitOrderIds: [] } });
  await expect(page.locator('#view-orders')).toBeVisible();
  expect(await readTimer(page)).toBeNull();
});

test('lunch alert pauses the timer once and does not re-pause after "Resume"', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T11:50', orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('15:00'); // 12:05 — the 12:00 alert fires
  await expect(page.locator('#noon-toast')).toBeVisible();
  await expect(page.locator('#noon-toast-text')).toHaveText(/12:00 p\.?m\.? — Timer paused/i);
  await expect(page.locator('#timer-status')).toHaveText('⏸ PAUSED');
  // Paused at the alert time, not when the app noticed
  await expect(page.locator('#timer-display')).toHaveText(/^00:(09:5\d|10:00)$/);

  await page.locator('#noon-toast').getByRole('button', { name: '▶ Resume' }).click();
  await expect(page.locator('#timer-status')).toHaveText('● RECORDING');

  // Re-opening the app during lunch used to pause the timer again
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#timer-status')).toHaveText('● RECORDING');
  await expect(page.locator('#noon-toast')).toBeHidden();
});

test('"I kept working" keeps the time the alert would have dropped', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T11:50', orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('20:00'); // 12:10
  await page.locator('#noon-toast').getByRole('button', { name: 'I kept working' }).click();
  await expect(page.locator('#timer-display')).toHaveText(/^00:20:0\d$/);
});

test('a timer started after lunch is not paused by the lunch alert on reopen', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T12:05', orders: twoOrders() });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('05:00');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#timer-status')).toHaveText('● RECORDING');
});

test('alerts use the times from Settings', async ({ page }) => {
  await openApp(page, { now: '2026-10-21T14:00', orders: twoOrders(), settings: { goalMin: 450, lunchStart: '12:00', lunchDur: 30, dayEnd: '15:30' } });
  await startOn(page, 'PO-A');
  await page.clock.fastForward('01:31:00'); // 15:31
  await expect(page.locator('#four-pm-toast')).toBeVisible();
  await expect(page.locator('#four-pm-toast-text')).toHaveText(/3:30 p\.?m\.? — Timer paused/i);
  await page.locator('#four-pm-toast').getByRole('button', { name: 'Stay paused' }).click();
  await expect(page.locator('#four-pm-toast')).toBeHidden();
  await expect(page.locator('#timer-status')).toHaveText('⏸ PAUSED');
});

test('reopening the app after an alert was missed pauses at the alert time', async ({ page }) => {
  // Timer started 11:30; the phone slept through 12:00 and the app is reopened at 12:10
  const orders = twoOrders();
  const began = at('2026-10-21T11:30');
  await openApp(page, {
    now: '2026-10-21T12:10',
    orders,
    timer: { timerStart: began, _origTimerStart: began, timerBeganAt: began, activeOrderId: orders[0].id, splitOrderIds: [], timerPausedAt: null, activeTimerAdj: 0 },
  });
  await expect(page.locator('#view-timer')).toBeVisible();
  await expect(page.locator('#noon-toast')).toBeVisible();
  await expect(page.locator('#timer-status')).toHaveText('⏸ PAUSED');
  await expect(page.locator('#timer-display')).toHaveText('00:30:00');
});
