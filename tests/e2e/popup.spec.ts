/**
 * The toolbar popup in a real browser: status of the
 * current site, quick actions and their effect on the open tab.
 */

import { expect, test } from './harness';
import { BLOCK, delay, group, policy, REMINDER, TRACK, timeBudget } from './harness/config';
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
  // The remaining time of the budget.
  await p3.get('.hero .status').expectText(/^(29|30) min left$/);
  await p3.button('Why?').click();
  await p3.get('.hero-why').expectText('video.test');
  await p3.get('.hero-why').expectText(/Video/);
});

test('"Block site" adds this page, this section or the whole site, and restricts the tab at once', async ({
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
  // The rule that blocks at all times is the default.
  await popup.text('Blocked right away, at all times.').expectVisible();
  await popup.button('Block', { exact: true }).click();
  await site.expectIntervention(true, 5000);
  const [misc] = (await h.rpc('config.get')).config.groups;
  expect(misc.targets[1]).toMatchObject({ type: 'page', value: 'shop.test/cart/item?id=3' });
  // Only that page: the rest of the site still loads.
  await expectAllowed(h, 'http://shop.test/cart/other');
});

test('"Block site" blocks: a rule that does not block now is not the default, and the popup says why', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [
      group('Never now', ['other.test'], [policy(BLOCK, { schedule: { mode: 'during', windows: [] } })]),
    ];
  });
  const [rule] = (await h.rpc('config.get')).config.groups;
  const site = await expectAllowed(h, 'http://wiki.test/article');
  const popup = await h.popup(site);
  await popup.button('Block site').click();
  await popup.text('A new rule that blocks it at all times, set up in the rule editor.').expectVisible();
  await popup.button('Continue in the editor').expectVisible();
  await popup.label('Add to').select(rule.id);
  await popup.text(/^“Never now” does not block/).expectVisible();
  await popup.button('Block', { exact: true }).expectVisible();
});

test('"Block site" › New rule… sets the rule up in the rule editor, with the site blocked at all times', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Misc', ['misc.test'], [policy(TRACK)])];
  });
  const site = await expectAllowed(h, 'http://wiki.test/article/1');
  const open = async () => {
    const popup = await h.popup(site);
    await popup.button('Block site').click();
    await popup.role('radio', /This section/).click();
    // The name is asked in the editor's Details.
    await popup.label('Add to').expectValue('new');
    await popup.get('.panel input').expectCount(0);
    return h.newTab(() => popup.button('Continue in the editor').click());
  };

  // Cancelled: nothing is created.
  let p = await open();
  await p.role('heading', 'Which sites?').expectVisible();
  await p.text('wiki.test/article/1', { within: '.target-row' }).expectVisible();
  await p.button('Cancel').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  expect((await h.rpc('config.get')).config.groups).toHaveLength(1);
  await expectAllowed(h, 'http://wiki.test/article/2');

  // Created: every part is seen, Block at all times is already chosen.
  p = await open();
  await p.text('wiki.test/article/1', { within: '.target-row' }).expectVisible();
  await p.button('Next: when').click();
  await p.role('radio', /Every time/).expectChecked();
  await p.button('Next: what happens').click();
  await p.role('radio', 'Block').expectChecked();
  await p.button('Next: protection').click();
  await p.role('radio', /^Reminder/).click();
  await p.button('Next: details').click();
  await p.label('Name', { exact: true }).expectValue('');
  await p.label('Name', { exact: true }).fill('Wiki');
  await p.button('Next: summary').click();
  await p.get('.plan-text').expectText('WebHandbrake blocks the page.');
  await p.button('Create rule').click();
  await p.role('heading', 'Rules', { exact: true }).expectVisible();
  const wiki = (await h.rpc('config.get')).config.groups.find((g: any) => g.name === 'Wiki');
  expect(wiki.targets.map((x: any) => [x.type, x.value])).toEqual([['path', 'wiki.test/article/1']]);
  expect(wiki.policies[0]).toMatchObject({ schedule: { mode: 'always' }, intervention: { type: 'block' } });
  expect(wiki.pause.allowed).toBe(false);
  await site.expectIntervention(true, 5000);
  await expectAllowed(h, 'http://wiki.test/');
});

test('"Save for later" from the popup, counted in its footer', async ({ h }) => {
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

test('the popup reopens the tabs that are allowed again', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)])];
    for (const g of c.groups) g.protection = REMINDER;
  });
  const a = await expectBlocked(h, 'http://news.test/1');
  const b = await expectBlocked(h, 'http://news.test/2');
  await h.configure((c) => {
    c.groups[0].enabled = false;
  });
  const popup = await h.popup();
  await popup.button('Reopen 2 tabs that are available again').click();
  await a.expectReal('news.test/1');
  await b.expectReal('news.test/2');
});

test('the popup leaves the times you chose not to go in to the dashboard, and pages it cannot act on alone', async ({
  h,
}) => {
  await h.configure((c) => {
    c.groups = [group('Video', ['video.test'], [policy(delay(30))])];
  });
  const p = await expectBlocked(h, 'http://video.test/');
  await p.button('Close the tab').click();
  const dashboard = await h.page('dashboard.html#/today');
  const popup = await h.popup(dashboard);
  await popup.button('Dashboard', { exact: true }).expectVisible();
  expect(await popup.get('.foot').text()).not.toMatch(/chose not to go in/);
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

test('the whole Dashboard bar at the end of the popup is one button, named by its label alone', async ({
  h,
}) => {
  await h.configure(() => undefined);
  await h.rpc('later.add', { url: 'http://later.test/' });
  const popup = await h.popup(await h.open('http://site.test/'));
  // It says only how many pages are saved for later.
  await popup.get('.foot').expectText('1 page saved for later');
  expect(await popup.get('.foot').text()).not.toMatch(/limited sites/);
  // Its icon, its figure and its arrow are all the button: the label alone names it.
  const hits = await popup.eval(() => {
    const button = document.querySelector('.foot button')!;
    return [...document.querySelectorAll('.open-dashboard-icon, #open-dashboard-later, .foot .icon-svg')].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button;
      },
    );
  });
  expect(hits.length).toBeGreaterThanOrEqual(3);
  expect(hits.every(Boolean)).toBe(true);
  await popup.button('Dashboard', { exact: true }).expectCount(1);
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
