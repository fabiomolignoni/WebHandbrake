import { expect, test } from '@playwright/test';
import { TEMPLATES } from '../../src/data/templates';
import { BLOCK, delay, group, policy, target } from './fixtures';
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

test('ENF-01: a blocked site is stopped before any request reaches the network', async () => {
  await h.configure((c) => {
    c.groups = [group('Block', ['blocked.test'], [policy(BLOCK)])];
  });
  const p = await h.open('http://www.blocked.test/page?x=1');
  expect(isIntervention(p.url())).toBe(true);
  expect(p.url()).toContain('#http://www.blocked.test/page?x=1');
  await expect(p.locator('h1')).toContainText('protected');
  expect(h.requests.filter((r) => r.startsWith('www.blocked.test'))).toEqual([]);
  const free = await h.open('http://free.test/');
  await expect(free.locator('#real')).toHaveText('REAL free.test/');
});

test('ENF-01: a site in every country ("shop.*") is stopped before any request', async () => {
  await h.configure((c) => {
    c.groups = [group('Shop', ['shop.*', 'store.test/cart'], [policy(BLOCK)])];
  });
  for (const url of ['http://www.shop.co.test/item', 'http://shop.test/', 'http://store.test/cart/1']) {
    const p = await h.open(url);
    expect(isIntervention(p.url()), url).toBe(true);
  }
  expect(h.requests.filter((r) => /shop\.|store\.test\/cart/.test(r))).toEqual([]);
});

test('ENF-01: every ready-made list fits the browser filters (none left to the fallback)', async () => {
  await h.configure((c) => {
    c.groups = TEMPLATES.map((tpl) => group(tpl.id, tpl.sites, [policy(BLOCK)]));
  });
  const d = (await h.rpc('diag.get')) as any;
  expect(d.rules.lastError).toBeNull();
  expect(d.rules.overflow).toEqual([]);
  expect(d.rules.regex).toBeGreaterThan(0);
});

test('MAT-04 / SEM-06: exceptions and exceptions of exceptions', async () => {
  await h.configure((c) => {
    const g = group('Reddit', ['reddit.test'], [policy(BLOCK)]);
    g.targets.push(target('+reddit.test/r/*/comments'), target('reddit.test/r/funny'));
    c.groups = [g];
  });
  const ok = await h.open('http://reddit.test/r/rust/comments/1');
  await expect(ok.locator('#real')).toHaveText('REAL reddit.test/r/rust/comments/1');
  const funny = await h.open('http://reddit.test/r/funny/comments/1');
  expect(isIntervention(funny.url())).toBe(true);
  const home = await h.open('http://reddit.test/');
  expect(isIntervention(home.url())).toBe(true);
});

test('SEM-03: the most severe group wins whatever the order', async () => {
  await h.configure((c) => {
    c.groups = [
      group('Soft', ['both.test'], [policy(delay(30))]),
      group('Hard', ['both.test'], [policy(BLOCK)]),
    ];
  });
  const p = await h.open('http://both.test/');
  expect(isIntervention(p.url())).toBe(true);
  await expect(p.locator('.meta')).toContainText('Hard');
  await expect(p.getByRole('button', { name: 'Continue' })).toHaveCount(0);
});

test('SEM-05: always allowed prevails over groups', async () => {
  await h.configure((c) => {
    c.settings.protection.level = 'soft';
  });
  await h.configure((c) => {
    c.groups = [group('Block', ['bank.test'], [policy(BLOCK)])];
    c.allowlist = [target('bank.test/login')];
  });
  const p = await h.open('http://bank.test/login/x');
  await expect(p.locator('#real')).toHaveText('REAL bank.test/login/x');
});

test('ENF-03: single page navigation to a blocked path is caught', async () => {
  await h.configure((c) => {
    c.groups = [group('Shorts', ['spa.test/shorts'], [policy(BLOCK)])];
  });
  const p = await h.open('http://spa.test/home');
  await expect(p.locator('#real')).toBeVisible();
  await p.evaluate(() => history.pushState({}, '', '/shorts/123'));
  await expect
    .poll(() => p.url(), { timeout: 5000 })
    .toContain('intervention.html#http://spa.test/shorts/123');
});

test('INT-02: a delay lets the page through after the wait, for the visit', async () => {
  await h.configure((c) => {
    c.groups = [group('Wait', ['wait.test'], [policy(delay(2))])];
  });
  const p = await h.open('http://wait.test/a');
  expect(isIntervention(p.url())).toBe(true);
  const cont = p.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await expect(cont).toBeEnabled({ timeout: 5000 });
  await cont.click();
  await expect(p.locator('#real')).toHaveText('REAL wait.test/a', { timeout: 5000 });
  const again = await h.open('http://wait.test/b');
  await expect(again.locator('#real')).toHaveText('REAL wait.test/b');
});

test('INT-04 / A11Y-05: a challenge can be passed with the accessible phrase, paste is refused', async () => {
  await h.configure((c) => {
    c.groups = [
      group(
        'Type',
        ['type.test'],
        [policy({ type: 'challenge', kind: 'random', length: 12, grant: { scope: 'site', mode: 'visit' } })],
      ),
    ];
  });
  const p = await h.open('http://type.test/');
  await expect(p.locator('canvas.challenge-canvas')).toBeVisible();
  await p.getByRole('button', { name: /screen reader/ }).click();
  const phrase = (await p.locator('form blockquote').textContent())!.trim();
  const input = p.getByLabel('Sentence');
  await input.focus();
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, phrase);
  await expect(input).toHaveValue('');
  await input.pressSequentially(phrase, { delay: 2 });
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.locator('#real')).toHaveText('REAL type.test/', { timeout: 5000 });
});

test('MAT-16: explain says which group, entry and policy apply', async () => {
  await h.configure((c) => {
    const g = group('Social', ['social.test'], [policy(BLOCK)]);
    g.targets.push(target('+social.test/help'));
    c.groups = [g];
  });
  const d = (await h.rpc('explain', { url: 'http://social.test/help/a' })) as any;
  expect(d.severity).toBe(0);
  expect(d.excepted[0].name).toBe('Social');
  const d2 = (await h.rpc('explain', { url: 'http://m.social.test/' })) as any;
  expect(d2.intervention.type).toBe('block');
  expect(d2.primary.entry.value).toBe('social.test');
});
