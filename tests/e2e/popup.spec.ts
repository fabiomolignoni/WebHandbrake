/**
 * The toolbar popup in a real browser (MAT-17, INT-12, LIM-10/11, ENF-04): status of the
 * current site, quick actions and their effect on the open tab.
 */

import { expect, test } from './harness';
import { BLOCK, delay, group, policy, TRACK, timeBudget } from './harness/config';
import { expectAllowed, expectBlocked, useUntil } from './helpers';

test('the popup is opened on the active tab of its window (no tab given)', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(BLOCK)])];
  });
  const site = await expectBlocked(h, 'http://video.test/watch');
  await site.front();
  // As the browser opens it: in the window of the active tab, which stays active.
  const popup = await h.newTab(() =>
    h.control.eval(
      (url: string) =>
        chrome.tabs
          .query({ active: true })
          .then(([t]) => chrome.tabs.create({ url, active: false, windowId: t.windowId })),
      `${h.origin}/popup.html`,
    ),
  );
  await popup.text('video.test', { exact: true }).expectVisible();
  await popup.text('Blocked', { exact: true }).expectVisible();
});

test('status of the current site: allowed, time counted, restricted, with "Why?"', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Video', ['video.test'], [policy(BLOCK, { budget: timeBudget(30) })], { note: 'Sleep earlier' }),
      group('Read', ['read.test'], [policy(TRACK)]),
    ];
  });
  const free = await expectAllowed(h, 'http://free.test/');
  const p1 = await h.popup(free);
  await p1.text('No rules on this site', { exact: true }).expectVisible();
  const read = await expectAllowed(h, 'http://read.test/');
  const p2 = await h.popup(read);
  await p2.text('Allowed', { exact: true, within: '.hero' }).expectVisible();
  await p2.text('Read', { exact: true, within: '.hero' }).expectVisible();
  const video = await expectAllowed(h, 'http://video.test/');
  await useUntil(video, async () => false, 2000);
  const p3 = await h.popup(video);
  // LIM-10: the remaining time of the budget.
  await p3.get('.hero .status').expectText(/^(29|30) min left$/);
  await p3.button('Why?').click();
  await p3.get('.hero-why').expectText('video.test');
  await p3.get('.hero-why').expectText(/Video/);
});

test('MAT-17: "Block site" adds this page, this section or the whole site, and restricts the tab at once', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Misc', ['misc.test'], [policy(BLOCK)])];
  });
  const site = await expectAllowed(h, 'http://shop.test/cart/item?id=3');
  const popup = await h.popup(site);
  await popup.button('Block site').click();
  await popup.role('radio', /Whole site/).expectChecked();
  await popup.role('radio', /This section/).expectVisible();
  await popup.role('radio', /This page/).click();
  await popup.label('Add to').select('new');
  await popup.label('Name of the new rule').fill('Shopping');
  await popup.button('Block', { exact: true }).click();
  await site.expectIntervention(true, 5000);
  const cfg = (await h.rpc('config.get')).config;
  const shopping = cfg.groups.find((g: any) => g.name === 'Shopping');
  expect(shopping.targets[0]).toMatchObject({ type: 'page', value: 'shop.test/cart/item?id=3' });
  // Only that page: the rest of the site still loads.
  await expectAllowed(h, 'http://shop.test/cart/other');
});

test('INT-12: "Save for later" from the popup, counted in its footer', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(TRACK)])];
  });
  const site = await expectAllowed(h, 'http://news.test/long-read');
  const popup = await h.popup(site);
  await popup.button('Save for later').click();
  await popup.text('Saved for later.').expectVisible();
  await popup.text('1 page saved for later').expectVisible();
  expect((await h.rpc('later.list')).items[0].url).toBe('http://news.test/long-read');
});

test('ENF-04: the popup reopens the tabs that are allowed again', async ({ h }) => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
    c.groups = [group('News', ['news.test'], [policy(BLOCK)])];
  });
  const a = await expectBlocked(h, 'http://news.test/1');
  const b = await expectBlocked(h, 'http://news.test/2');
  await h.configure((c) => {
    c.groups[0].enabled = false;
  });
  const popup = await h.popup();
  await popup.button('Reopen 2 tabs that can be opened again').click();
  await a.expectReal('news.test/1');
  await b.expectReal('news.test/2');
});

test('the popup counts the impulses resisted today, and leaves pages it cannot act on alone', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(delay(30))])];
  });
  const p = await expectBlocked(h, 'http://video.test/');
  await p.button('Close the tab').click();
  const dashboard = await h.page('dashboard.html#/today');
  const popup = await h.popup(dashboard);
  await popup.text('Once you chose not to go in.').expectVisible();
  // An extension page: nothing to block or save.
  await popup.button('Block site').expectCount(0);
  await popup.button('Save for later').expectCount(0);
});

test('the popup keeps its width when the browser sizes it from its content', async ({ h }) => {
  // Browsers size popups from their content, starting from a tiny viewport: a 40 px wide frame.
  const page = await h.page('popup.html');
  const width = await page.eval(async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width: 40px; height: 400px; border: 0';
    frame.src = 'popup.html';
    document.body.appendChild(frame);
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const el = frame.contentDocument?.querySelector('.popup-head');
      if (el) return frame.contentDocument!.querySelector('.popup')!.getBoundingClientRect().width;
    }
    return 0;
  });
  expect(width).toBe(380);
});

test('the Dashboard button works after the browser has stopped the background (regression)', async ({
  h,
  browserName,
}) => {
  await h.configure(() => undefined);
  const popup = await h.popup(await h.open('http://site.test/'));
  await popup.button('Dashboard', { exact: true }).expectVisible();
  // As Chrome does with an idle service worker: the request must wait for it to start again.
  if (browserName === 'chromium') expect(await h.stopBackground()).toBe(true);
  const dashboards = async () => (await h.tabs()).filter((t) => t.url.includes('/dashboard.html')).length;
  const before = await dashboards();
  await popup.button('Dashboard', { exact: true }).click();
  await expect.poll(dashboards).toBe(before + 1);
});
