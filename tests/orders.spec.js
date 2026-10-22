// Organizing orders: sorting, filtering, searching, editing, deleting,
// bulk actions and the archive.
const { test, expect, at, order, session, openApp, readDB, card, archiveCard, openOrder } = require('./helpers');

const seed = () => [
  order('PO-10', { created: at('2026-10-15T08:00'), tags: ['Gantry'], sessions: [session('2026-10-20T13:00', 90, { cnf: true })] }),
  order('PO-9',  { created: at('2026-10-18T08:00'), tags: ['Kit'], notes: 'waiting on brackets', sessions: [session('2026-10-16T09:00', 20)] }),
  order('PO-100', { created: at('2026-10-20T08:00'), tags: ['Kit', 'Gantry'] }),
];
const listed = page => page.locator('#orders-list .order-po').allTextContents();

test('sorts orders and remembers the choice', async ({ page }) => {
  await openApp(page, { orders: seed() });
  expect(await listed(page)).toEqual(['PO-100', 'PO-9', 'PO-10']); // newest first by default

  await page.selectOption('#orders-sort', 'po');
  expect(await listed(page)).toEqual(['PO-9', 'PO-10', 'PO-100']); // natural number order
  await page.selectOption('#orders-sort', 'time');
  expect(await listed(page)).toEqual(['PO-10', 'PO-9', 'PO-100']);
  await page.selectOption('#orders-sort', 'worked');
  expect(await listed(page)).toEqual(['PO-10', 'PO-100', 'PO-9']);

  await page.reload();
  await expect(page.locator('#orders-sort')).toHaveValue('worked');
});

test('favorites are pinned to the top and can be filtered', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await card(page, 'PO-10').locator('.fav-star').click();
  expect(await listed(page)).toEqual(['PO-10', 'PO-100', 'PO-9']);
  await expect(page.locator('#modal-detail')).not.toHaveClass(/open/); // star doesn't open the order

  await page.click('#chip-favorites');
  expect(await listed(page)).toEqual(['PO-10']);
  await expect(page.locator('#orders-section-title')).toHaveText('Showing 1 of 3');
});

test('tag chips filter the list and search covers PO, tags and notes', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await page.locator('#orders-filter-chips .tag-chip', { hasText: 'Kit' }).click();
  expect(await listed(page)).toEqual(['PO-100', 'PO-9']);
  await page.locator('#orders-filter-chips .tag-chip', { hasText: 'Kit' }).click();

  await page.fill('#orders-search', 'brackets');
  expect(await listed(page)).toEqual(['PO-9']);
  await page.fill('#orders-search', 'PO-1*');
  expect(await listed(page)).toEqual(['PO-100', 'PO-10']);
  await page.fill('#orders-search', 'nothing-like-this');
  await expect(page.locator('#orders-list')).toContainText('No orders match');
});

test('the unconfirmed filter ignores deduction-only entries', async ({ page }) => {
  const deductionOnly = order('PO-DED', { sessions: [session('2026-10-20T09:00', 30, { cnf: true }), { start: at('2026-10-20T10:00'), date: at('2026-10-20T10:00'), duration: -5 * 60000, cnf: false, manual: true }] });
  await openApp(page, { orders: [...seed(), deductionOnly] });
  await page.click('#chip-unconfirmed');
  expect(await listed(page)).toEqual(['PO-9']);
  await page.click('#chip-unconfirmed');
  await expect(card(page, 'PO-DED')).not.toContainText('pending CNF');
});

test('edit PO number and notes from the order detail', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await openOrder(page, 'PO-9');
  await page.click('#detail-edit-btn');
  const poInput = page.locator('[id^=edit-po-]');
  await poInput.fill('PO-10'); // already used by another active order
  await page.locator('[id^=edit-save-]').click();
  await expect(page.locator('[id^=edit-error-]')).toHaveText('Another active order already uses PO-10.');

  await poInput.fill('PO-0009');
  await page.locator('[id^=edit-notes-]').fill('brackets arrived');
  await page.locator('[id^=edit-save-]').click();
  await expect(page.locator('#modal-detail-title')).toHaveText('PO-0009');
  await expect(page.locator('#modal-detail')).toContainText('brackets arrived');
  const db = await readDB(page);
  expect(db.orders.find(o => o.po === 'PO-0009').notes).toBe('brackets arrived');
});

test('edit PO number of an archived order', async ({ page }) => {
  await openApp(page, { archive: [order('PO-TYPO', { finishedAt: at('2026-10-19T10:00') })] });
  await page.click('#tab-archive');
  await archiveCard(page, 'PO-TYPO').click();
  await page.click('#detail-edit-btn');
  await page.locator('[id^=edit-po-]').fill('PO-FIXED');
  await page.locator('[id^=edit-save-]').click();
  await expect(page.locator('#modal-detail-title')).toHaveText('PO-FIXED');
  const db = await readDB(page);
  expect(db.archive[0].po).toBe('PO-FIXED');
});

test('edit tags from the order detail', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await openOrder(page, 'PO-100');
  await page.click('#detail-tags-edit');
  await page.locator('#modal-detail .tag', { hasText: 'Gantry' }).click(); // remove
  await page.locator('[id^=detail-tag-input-]').fill('Urgent');
  await page.locator('[id^=detail-tag-input-]').press('Enter');
  await page.locator('#modal-detail .tag.custom', { hasText: 'Urgent' }).click(); // remove custom again
  await page.locator('[id^=detail-tag-input-]').fill('Hold');
  await page.locator('[id^=detail-tag-input-]').press('Enter');
  const db = await readDB(page);
  expect(db.orders.find(o => o.po === 'PO-100').tags).toEqual(['Kit', 'Hold']);
});

test('delete an active order (with confirmation)', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await openOrder(page, 'PO-100');
  await page.click('#detail-delete-btn');
  await expect(page.locator('#confirm-modal-body')).toContainText('PO-100 and its 0 sessions');
  await page.click('#confirm-modal-cancel');
  expect((await readDB(page)).orders).toHaveLength(3);

  await page.click('#detail-delete-btn');
  await page.click('#confirm-modal-ok');
  await expect(card(page, 'PO-100')).toHaveCount(0);
  expect((await readDB(page)).orders.map(o => o.po)).toEqual(['PO-10', 'PO-9']);
});

test('finishing warns about sessions that are not CNF\'d', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await openOrder(page, 'PO-9');
  await page.click('#detail-finish-btn');
  await expect(page.locator('#confirm-modal-body')).toContainText("1 session (20 min) not CNF'd yet");
  await page.click('#confirm-modal-ok');
  await page.click('#tab-archive');
  await expect(archiveCard(page, 'PO-9')).toBeVisible();
});

test('Select button: bulk CNF + finish', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await page.click('#orders-select-btn');
  await expect(page.locator('#multiselect-bar')).toBeVisible();
  await expect(page.locator('#ms-both-btn')).toBeDisabled();
  await card(page, 'PO-9').click();
  await card(page, 'PO-10').click();
  await expect(page.locator('#multiselect-count')).toHaveText('2 orders selected');
  await page.click('#ms-both-btn');

  const db = await readDB(page);
  expect(db.orders.map(o => o.po)).toEqual(['PO-100']);
  expect(db.archive.every(o => o.sessions.every(s => s.cnf))).toBe(true);
  await expect(page.locator('#multiselect-bar')).toBeHidden();
});

test('long-press also enters selection mode; "All" selects every visible order', async ({ page }) => {
  await openApp(page, { orders: seed() });
  const box = await card(page, 'PO-10').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.mouse.up();
  await expect(page.locator('#multiselect-count')).toHaveText('1 order selected');
  await page.locator('#multiselect-bar').getByRole('button', { name: 'Select all' }).click();
  await expect(page.locator('#multiselect-count')).toHaveText('3 orders selected');
  await page.click('#ms-cnf-btn');
  const db = await readDB(page);
  expect(db.orders.flatMap(o => o.sessions).every(s => s.cnf)).toBe(true);
});

test('bulk split timer from selected orders', async ({ page }) => {
  await openApp(page, { orders: seed() });
  await page.click('#orders-select-btn');
  await card(page, 'PO-9').click();
  await card(page, 'PO-100').click();
  await page.click('#ms-split-btn');
  await expect(page.locator('#timer-po-label')).toHaveText('Split — 2 Orders');
  await page.clock.fastForward('10:00');
  await page.click('#timer-stop-btn');
  await page.click('#stop-save-btn');
  const db = await readDB(page);
  expect(Math.round(db.orders.find(o => o.po === 'PO-100').sessions[0].duration / 60000)).toBe(5);
});

test('archive: delete needs confirmation, unarchive restores', async ({ page }) => {
  const done = t => ({ finishedAt: at(t) });
  await openApp(page, { archive: [order('PO-OLD', done('2026-10-01T15:00')), order('PO-NEW', done('2026-10-20T15:00')), order('PO-MID', done('2026-10-10T15:00'))] });
  await page.click('#tab-archive');
  expect(await page.locator('#archive-list .order-po').allTextContents()).toEqual(['PO-NEW', 'PO-MID', 'PO-OLD']);

  await page.click('#archive-select-btn');
  await archiveCard(page, 'PO-OLD').click();
  await page.click('#archive-ms-delete');
  await expect(page.locator('#modal-confirm')).toHaveClass(/open/);
  await page.click('#confirm-modal-cancel');
  expect((await readDB(page)).archive).toHaveLength(3); // nothing deleted without confirming

  await page.click('#archive-ms-delete');
  await page.click('#confirm-modal-ok');
  expect((await readDB(page)).archive.map(o => o.po)).toEqual(['PO-NEW', 'PO-MID']);

  await archiveCard(page, 'PO-MID').click();
  await page.click('#detail-unarchive-btn');
  const db = await readDB(page);
  expect(db.orders.map(o => o.po)).toEqual(['PO-MID']);
  expect(db.archive.map(o => o.po)).toEqual(['PO-NEW']);
});
