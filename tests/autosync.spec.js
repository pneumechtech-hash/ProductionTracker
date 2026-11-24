// Auto-export: writing a dated backup into a picked folder after every save
// (for Syncthing etc.). The real pickers can't be driven by tests, so they are
// replaced by fake handles that record what gets written, by file name.
const { test, expect, order, openApp, createOrder } = require('./helpers');

async function fakePicker(page, { folder = true } = {}) {
  await page.addInitScript(folder => {
    window.__writes = [];
    window.__perm = 'granted';
    const perms = {
      queryPermission: async () => window.__perm,
      requestPermission: async () => { window.__perm = 'granted'; return 'granted'; },
    };
    const fileHandle = name => ({
      kind: 'file', name, ...perms,
      createWritable: async () => {
        let buf = '';
        return { write: async d => { buf += d; }, close: async () => { window.__writes.push({ name, data: JSON.parse(buf) }); } };
      },
    });
    if (folder) {
      const dir = { kind: 'directory', name: 'Sync', ...perms, getFileHandle: async name => fileHandle(name) };
      window.showDirectoryPicker = async () => dir;
    } else {
      delete window.showDirectoryPicker;
      window.showSaveFilePicker = async () => fileHandle('po-tracker-sync.json');
    }
  }, folder);
}

const writes = page => page.evaluate(() => window.__writes);
const pos = w => w.data.orders.map(o => o.po).sort();

async function turnOn(page, expected) {
  await page.click('.gear-btn');
  await page.click('#autosync-btn');
  await expect(page.locator('#autosync-status')).toContainText(`${expected} — saved`);
  await page.locator('#modal-settings .modal-close').click();
}

test('picking a folder writes a dated file at once, then again shortly after each save', async ({ page }) => {
  await fakePicker(page);
  await openApp(page, { now: '2026-10-21T09:00', orders: [order('PO-A')] });
  await turnOn(page, 'Sync/po-tracker-2026-10-21.json');

  let w = await writes(page);
  expect(w).toHaveLength(1);
  expect(w[0].name).toBe('po-tracker-2026-10-21.json');
  expect(pos(w[0])).toEqual(['PO-A']);
  expect(w[0].data.app).toBe('po-tracker');

  await createOrder(page, 'PO-B');
  await page.clock.runFor(2500);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  w = await writes(page);
  expect(w[1].name).toBe('po-tracker-2026-10-21.json');
  expect(pos(w[1])).toEqual(['PO-A', 'PO-B']);
});

test('a new day starts a new dated file', async ({ page }) => {
  await fakePicker(page);
  await openApp(page, { now: '2026-10-21T23:58', orders: [order('PO-A')] });
  await turnOn(page, 'Sync/po-tracker-2026-10-21.json');

  await page.clock.runFor(5 * 60000); // past midnight
  await createOrder(page, 'PO-B');
  await page.clock.runFor(2500);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  expect((await writes(page))[1].name).toBe('po-tracker-2026-10-22.json');
});

test('without a folder picker it falls back to rewriting one file', async ({ page }) => {
  await fakePicker(page, { folder: false });
  await openApp(page, { orders: [order('PO-A')] });
  await turnOn(page, 'po-tracker-sync.json');

  await createOrder(page, 'PO-B');
  await page.clock.runFor(2500);
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  expect((await writes(page)).map(w => w.name)).toEqual(['po-tracker-sync.json', 'po-tracker-sync.json']);
});

test('lost permission pauses auto-export until the banner is tapped', async ({ page }) => {
  await fakePicker(page);
  await openApp(page, { orders: [order('PO-A')] });
  await turnOn(page, 'po-tracker-2026-10-21.json');

  await page.evaluate(() => { window.__perm = 'prompt'; });
  await createOrder(page, 'PO-B');
  await page.clock.runFor(2500);
  await expect(page.locator('#autosync-banner')).toBeVisible();
  expect(await writes(page)).toHaveLength(1);

  await page.click('#autosync-banner');
  await expect(page.locator('#autosync-banner')).toBeHidden();
  await expect.poll(async () => (await writes(page)).length).toBe(2);
  expect(pos((await writes(page))[1])).toEqual(['PO-A', 'PO-B']);
});

test('stopping auto-export ends the writes', async ({ page }) => {
  await fakePicker(page);
  await openApp(page, { orders: [order('PO-A')] });
  await turnOn(page, 'po-tracker-2026-10-21.json');

  await page.click('.gear-btn');
  await page.click('#autosync-off-btn');
  await expect(page.locator('#autosync-status')).toHaveText('Off');
  await page.locator('#modal-settings .modal-close').click();

  await createOrder(page, 'PO-B');
  await page.clock.runFor(5000);
  expect(await writes(page)).toHaveLength(1);
});
