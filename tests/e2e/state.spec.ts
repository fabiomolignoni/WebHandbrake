import { expect, test } from '@playwright/test';
import { BLOCK, group, pauseFree, policy, target } from './fixtures';
import { type Harness, launch } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const isIntervention = (url: string) => url.includes('/intervention.html#');

test('BRK-07 / BRK-09 / ENF-02: a break unblocks, ending it re-blocks open tabs at once', async () => {
  await h.configure((c) => {
    c.groups = [group('News', ['news.test'], [policy(BLOCK)], { pause: pauseFree })];
  });
  const p = await h.open('http://news.test/article');
  expect(isIntervention(p.url())).toBe(true);
  const start = (await h.rpc('pause.start', {
    url: 'http://news.test/article',
    scope: 'site',
    minutes: 5,
  })) as any;
  expect(start.error).toBeUndefined();
  if (start.ticket) await h.completeTicket(start.ticket);
  // The intervention page notices the change and offers to reopen (ENF-04).
  await expect(p.getByRole('button', { name: 'Reopen the page' })).toBeVisible({ timeout: 5000 });
  await p.getByRole('button', { name: 'Reopen the page' }).click();
  await expect(p.locator('#real')).toBeVisible();
  const ov = (await h.rpc('overview.get')) as any;
  expect(ov.pauses).toHaveLength(1);
  const t0 = Date.now();
  await h.rpc('pause.cancel', { all: true });
  await expect.poll(() => isIntervention(p.url()), { timeout: 5000 }).toBe(true);
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(p.url()).toContain('#http://news.test/article');
});

test('PRO-02 / PRO-03: strengthening is immediate, weakening waits under Strict', async () => {
  await h.configure((c) => {
    c.groups = [group('Social', ['a.test'], [policy(BLOCK)])];
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  // Adding a site: immediate.
  const add = await h.configure((c) => {
    c.groups[0].targets.push(target('b.test'));
  });
  expect(add.applied).toHaveLength(1);
  expect(isIntervention((await h.open('http://b.test/')).url())).toBe(true);
  // Removing a site while the group is active: refused (settings locked while active, PRO-04).
  const remove = await h.configure((c) => {
    c.groups[0].targets = c.groups[0].targets.filter((t: any) => t.value !== 'a.test');
  });
  expect(remove.refused?.reason).toBe('lockedNow');
  expect(isIntervention((await h.open('http://a.test/')).url())).toBe(true);
});

test('PRO-03: a weakening of an inactive strict group goes to cooling-off and stays pending', async () => {
  await h.configure((c) => {
    c.groups = [
      group(
        'Evenings',
        ['late.test'],
        [policy(BLOCK, { schedule: { mode: 'during', windows: [{ days: [], start: 0, end: 60 }] } })],
      ),
    ];
    c.groups[0].policies[0].schedule.windows[0].days = [0, 1, 2, 3, 4, 5, 6].filter(
      (d) => d !== new Date().getDay() && d !== (new Date().getDay() + 6) % 7,
    );
  });
  await h.configure((c) => {
    c.settings.protection.level = 'strict';
  });
  const remove = await h.configure((c) => {
    c.groups[0].targets = [];
    c.groups[0].targets.push(target('other.test'));
  });
  expect(remove.applied.map((u: any) => u.kind)).toEqual(['target.add']);
  expect(remove.pending.units.map((u: any) => u.kind)).toEqual(['target.remove']);
  const ov = (await h.rpc('overview.get')) as any;
  expect(ov.pending).toHaveLength(1);
  const confirm = (await h.rpc('pending.confirm', { id: ov.pending[0].id })) as any;
  expect(confirm.error).toBe('pending.error.notReady');
  await h.rpc('pending.cancel', { id: ov.pending[0].id });
  expect(((await h.rpc('overview.get')) as any).pending).toHaveLength(0);
});

test('TIM-01 / LIM-01 / ENF-02: active time is counted and an exhausted budget applies within seconds', async () => {
  await h.configure((c) => {
    c.groups = [
      group(
        'Video',
        ['video.test'],
        [policy(BLOCK, { budget: { type: 'time', minutes: 0.1, period: { kind: 'day' } } })],
      ),
    ];
  });
  const p = await h.open('http://video.test/watch');
  await expect(p.locator('#real')).toBeVisible();
  await p.bringToFront();
  // Keep the user "active" (TIM-02).
  const t0 = Date.now();
  while (!isIntervention(p.url()) && Date.now() - t0 < 20_000) {
    await p.mouse.move(10 + Math.random() * 100, 10 + Math.random() * 100).catch(() => undefined);
    await p.waitForTimeout(500);
  }
  expect(isIntervention(p.url())).toBe(true);
  const elapsed = (Date.now() - t0) / 1000;
  expect(elapsed).toBeGreaterThan(4);
  expect(elapsed).toBeLessThan(15);
  const ov = (await h.rpc('overview.get')) as any;
  expect(ov.today.seconds).toBeGreaterThanOrEqual(5);
});

test('FOC-02: an allowlist session blocks everything except the listed sites', async () => {
  await h.rpc('session.start', {
    kind: 'allowlist',
    groups: [],
    allow: [target('docs.test')],
    minutes: 30,
    locked: false,
    noPauses: true,
  });
  expect(isIntervention((await h.open('http://anything.test/')).url())).toBe(true);
  const docs = await h.open('http://docs.test/manual');
  await expect(docs.locator('#real')).toBeVisible();
  const ov = (await h.rpc('overview.get')) as any;
  expect(ov.sessions).toHaveLength(1);
});

test('INT-13: typing in a page gives a grace period before the restriction applies', async () => {
  await h.configure((c) => {
    c.settings.interventions.graceSeconds = 3;
    c.groups = [group('Forum', ['forum.test'], [policy(BLOCK)], { pause: pauseFree })];
  });
  const start = (await h.rpc('pause.start', {
    url: 'http://forum.test/',
    scope: 'group',
    minutes: 10,
  })) as any;
  if (start.ticket) await h.completeTicket(start.ticket);
  const p = await h.open('http://forum.test/thread');
  await expect(p.locator('#real')).toBeVisible();
  await p.bringToFront();
  await p.locator('#ta').click();
  await p.keyboard.type('a long comment I do not want to lose');
  await p.waitForTimeout(500);
  const t0 = Date.now();
  await h.rpc('pause.cancel', { all: true });
  await p.waitForTimeout(1200);
  expect(isIntervention(p.url())).toBe(false);
  await expect(p.locator('webhandbrake-overlay')).toHaveCount(1);
  await expect.poll(() => isIntervention(p.url()), { timeout: 10_000 }).toBe(true);
  expect(Date.now() - t0).toBeGreaterThan(2500);
});
