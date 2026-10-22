// Backup / restore, CSV export, settings, stats and the timeline.
const fs = require('fs');
const { test, expect, MIN, at, order, session, openApp, readDB, card, openOrder } = require('./helpers');

const openSettings = async page => {
  await page.click('.gear-btn');
  await expect(page.locator('#modal-settings')).toHaveClass(/open/);
};

test('CSV export uses local date and start/end times', async ({ page }) => {
  await openApp(page, { orders: [order('PO-A', { tags: ['Kit', 'Gantry'], notes: 'has, comma', sessions: [session('2026-10-20T07:45', 50, { cnf: true })] })] });
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '↓ CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('po-tracker-2026-10-21.csv');
  const lines = fs.readFileSync(await download.path(), 'utf8').split('\r\n');
  expect(lines[0]).toBe('PO,Status,Tags,Notes,Date,Start,End,Duration (min),Duration (hh:mm:ss),CNF,Adjustment,Split Qty,Finished');
  expect(lines[1]).toBe('PO-A,Active,Kit;Gantry,"has, comma",2026-10-20,07:45,08:35,50,00:50:00,Yes,No,,');
});

test('JSON backup can be restored', async ({ page }) => {
  await openApp(page, { orders: [order('PO-KEEP', { sessions: [session('2026-10-20T08:00', 30)] })], archive: [order('PO-ARCH', { finishedAt: at('2026-10-19T10:00') })] });
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '↓ Backup' }).click()]);
  const backupPath = await download.path();
  await page.locator('#modal-settings .modal-close').click();

  // Lose some data
  await openOrder(page, 'PO-KEEP');
  await page.click('#detail-delete-btn');
  await page.click('#confirm-modal-ok');
  expect((await readDB(page)).orders).toHaveLength(0);

  await openSettings(page);
  await page.setInputFiles('#import-file', backupPath);
  await expect(page.locator('#confirm-modal-body')).toContainText('(0 active, 1 archived) with the backup (1 active, 1 archived)');
  await page.click('#confirm-modal-ok');
  await expect(card(page, 'PO-KEEP')).toBeVisible();
  const db = await readDB(page);
  expect(db.orders[0].sessions).toHaveLength(1);
  expect(db.archive[0].po).toBe('PO-ARCH');
});

test('restoring a file that is not a backup is refused', async ({ page }) => {
  await openApp(page, { orders: [order('PO-A')] });
  await openSettings(page);
  await page.setInputFiles('#import-file', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('#confirm-modal-title')).toHaveText('Restore Failed');
  await expect(page.locator('#confirm-modal-cancel')).toBeHidden();
  await page.click('#confirm-modal-ok');
  expect((await readDB(page)).orders).toHaveLength(1);
});

test('damaged stored data is repaired on load instead of breaking the app', async ({ page }) => {
  const raw = JSON.stringify({
    orders: [{ id: 1, po: 'PO-OK', sessions: [{ start: at('2026-10-20T08:00'), duration: 600000, cnf: true }] }, null, { id: 2, po: 'PO-NO-ARRAYS' }, { id: 3 }],
    archive: [{ id: 4, po: 'PO-ARCH', tags: 'oops', sessions: [null, { duration: 5 }] }],
  });
  await openApp(page, { raw });
  await expect(card(page, 'PO-OK')).toBeVisible();
  await expect(card(page, 'PO-NO-ARRAYS')).toContainText('0 sessions');
  await page.click('#tab-archive');
  await expect(page.locator('#archive-list .order-po')).toHaveText(['PO-ARCH']);
  await page.click('#tab-stats');
  await expect(page.locator('#stat-active-orders')).toHaveText('2');
});

test('settings: closing without saving discards tag edits; saving applies them', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#settings-tags-list .settings-tag-row', { hasText: 'Gantry' }).getByRole('button').click();
  await page.locator('#modal-settings .modal-close').click();
  await page.click('#tab-new');
  await page.fill('#manual-po', 'PO-1');
  await page.press('#manual-po', 'Enter');
  await expect(page.locator('#tags-grid .tag', { hasText: 'Gantry' })).toHaveCount(1); // still there

  await openSettings(page);
  await page.locator('#settings-tags-list .settings-tag-row', { hasText: 'Gantry' }).getByRole('button').click();
  await page.fill('#settings-tag-input', 'Welding');
  await page.press('#settings-tag-input', 'Enter');
  await page.fill('#settings-goal', '480');
  await page.click('#settings-save-btn');
  await expect(page.locator('#tags-grid .tag', { hasText: 'Gantry' })).toHaveCount(0);
  await expect(page.locator('#tags-grid .tag', { hasText: 'Welding' })).toHaveCount(1);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('po-tracker-settings-v1')));
  expect(saved.goalMin).toBe(480);
  expect(saved.tags).toContain('Welding');
  expect(saved.tags).not.toContain('Gantry');
  await page.click('#tab-stats');
  await expect(page.locator('#stat-goal-text')).toHaveText('of 480 min');
});

test('settings: "Reset form to defaults" only changes the form until saved', async ({ page }) => {
  await openApp(page, { settings: { goalMin: 300, lunchStart: '11:00', lunchDur: 45, dayEnd: '15:00', tags: ['Only'] } });
  await openSettings(page);
  await page.getByRole('button', { name: 'Reset form to defaults' }).click();
  await expect(page.locator('#settings-goal')).toHaveValue('450');
  await page.locator('#modal-settings .modal-close').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('po-tracker-settings-v1')));
  expect(saved.goalMin).toBe(300);
  await openSettings(page);
  await expect(page.locator('#settings-goal')).toHaveValue('300');
  await expect(page.locator('#app-version')).toHaveText(/^v\d+$/);
});

test('stats: today includes the running timer; deductions are never "unconfirmed"', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T10:00',
    orders: [
      order('PO-A', { sessions: [session('2026-10-21T08:00', 60, { cnf: true }), session('2026-10-20T08:00', 45)] }),
      order('PO-B', { sessions: [{ start: at('2026-10-19T09:00'), date: at('2026-10-19T09:00'), duration: -10 * MIN, cnf: false, manual: true }] }),
    ],
  });
  await openOrder(page, 'PO-B');
  await page.click('#detail-start-btn');
  await page.clock.fastForward('30:00');
  await page.click('#tab-stats');

  await expect(page.locator('#stat-today-min')).toHaveText('90 min');
  await expect(page.locator('#stat-today-running')).toBeVisible();
  await expect(page.locator('#stat-today-pct')).toHaveText('20%');
  await expect(page.locator('#stat-cnf-count')).toHaveText('1');
  await expect(page.locator('#stat-pending-count')).toHaveText('1');
  await expect(page.locator('#stat-prev-pending .stat-value')).toHaveText('45 min');
  await expect(page.locator('#stat-prev-pending')).toContainText('1 day');
});

test('timeline: shows the day\'s sessions, steps back over the weekend, lunch follows settings', async ({ page }) => {
  // 2026-10-19 is a Monday; Oct 17/18 are the weekend
  await openApp(page, {
    now: '2026-10-19T15:00',
    settings: { goalMin: 450, lunchStart: '11:30', lunchDur: 30, dayEnd: '16:00' },
    orders: [order('PO-MON', { sessions: [session('2026-10-19T08:00', 60)] }), order('PO-FRI', { sessions: [session('2026-10-16T10:00', 120, { cnf: true })] })],
  });
  await page.click('#timeline-toggle-btn');
  await expect(page.locator('#tl-day-label')).toHaveText(/^Today — Mon/);
  await expect(page.locator('#timeline-legend')).toContainText('PO-MON');
  await expect(page.locator('#tl-next-btn')).toBeDisabled();

  await page.click('#tl-prev-btn');
  await expect(page.locator('#tl-day-label')).toHaveText(/^Fri/);
  await expect(page.locator('#timeline-legend')).toContainText('PO-FRI');
  // The lunch block is drawn on the viewed day at the configured time
  await expect(page.locator('#timeline-container')).toContainText('Lunch');
  await expect(page.locator('#timeline-container')).toContainText('11:30');

  await page.click('#timeline-toggle-btn');
  await expect(page.locator('#orders-list')).toBeVisible();
});

test('timeline: editing an adjustment moves it in the session list too', async ({ page }) => {
  await openApp(page, {
    now: '2026-10-21T15:00',
    orders: [order('PO-A', { sessions: [session('2026-10-21T08:00', 60), session('2026-10-21T10:00', 15, { manual: true })] })],
  });
  await page.click('#timeline-toggle-btn');
  await page.locator('[data-adj-oid]').click();
  await expect(page.locator('#modal-adj-edit')).toHaveClass(/open/);
  await page.locator('#adj-edit-body .time-adjust-row').nth(1).getByRole('button', { name: '+15m' }).click();
  await page.locator('#adj-edit-body').getByRole('button', { name: 'Save' }).click();
  const s = (await readDB(page)).orders[0].sessions[1];
  expect(s.start).toBe(at('2026-10-21T10:15'));
  expect(s.date).toBe(at('2026-10-21T10:15'));
});
