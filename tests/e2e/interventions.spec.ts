/**
 * Interventions in a real browser: the intervention page, passes, challenges,
 * and filters, operated with real clicks and keystrokes.
 */

import { expect, type Harness, test } from './harness';
import { ask, BLOCK, challenge, delay, filter, group, policy, REMINDER } from './harness/config';
import { expectAllowed, expectBlocked, sleep } from './helpers';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The code of the challenge shown for a URL, read from the background tickets (never in the page). */
async function challengeCode(h: Harness, url: string): Promise<string> {
  return expect
    .poll(async () => {
      const tickets: any[] = await h.control.eval(() =>
        chrome.storage.session.get('tickets').then((r) => (r.tickets as unknown[]) ?? []),
      );
      return tickets.filter((t) => t.purpose.url === url).pop()?.active?.text ?? '';
    })
    .not.toBe('')
    .then(async () => {
      const tickets: any[] = await h.control.eval(() =>
        chrome.storage.session.get('tickets').then((r) => (r.tickets as unknown[]) ?? []),
      );
      return tickets.filter((t) => t.purpose.url === url).pop().active.text as string;
    });
}

test.describe('block page', () => {
  test('shows the rule, the note, the message and why; the healthy choice comes first', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Social', ['social.test'], [policy(BLOCK)], {
          note: 'Evenings with friends',
          message: 'Line one\nLine two',
        }),
      ];
    });
    const p = await expectBlocked(h, 'http://social.test/feed');
    await p.role('heading', 'This page is blocked right now.').expectVisible();
    await p.get('blockquote.note').expectText('Evenings with friends');
    await p.get('.message').expectText('Line one Line two');
    await p.get('.meta').expectText('social.test');
    await p.get('.meta').expectText('Social');
    // The primary action is closing the tab.
    await p.get('.actions .primary, .actions button').expectText('Close the tab');
    await p.button('Why?').click();
    await p.get('.why').expectText('Social');
    await p.get('.why').expectText('social.test');
    expect(await p.eval(() => document.title)).toBe('social.test — A moment of pause');
  });

  test('"Close the tab" closes it and counts an impulse resisted', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://social.test/');
    await p.button('Close the tab').click();
    await expect.poll(async () => (await h.tabs()).some((t) => t.url.includes('social.test'))).toBe(false);
    const stats = await h.rpc('stats.get', { from: today(), to: today() });
    expect(stats.counters.shown).toBe(1);
    expect(stats.counters.left).toBe(1);
    expect(stats.counters.impulses).toBe(1);
  });

  test('"Go back" returns to the previous page', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
    });
    const p = await expectAllowed(h, 'http://start.test/');
    await p.goto('http://social.test/');
    await p.expectIntervention();
    await p.button('Go back').click();
    await p.expectReal('start.test/');
  });

  test('the address can be hidden', async ({ h }) => {
    await h.configure((c) => {
      c.settings.interventions.hideUrl = true;
      c.groups = [group('Social', ['secret.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://secret.test/');
    await p.get('.meta').expectText('Social');
    expect(await p.get('.meta').text()).not.toContain('secret.test');
    expect(await p.eval(() => document.title)).toBe('A moment of pause');
  });

  test('custom CSS applies, but cannot load anything', async ({ h }) => {
    await h.configure((c) => {
      c.settings.interventions.customCss = [
        'h1 { color: rgb(1, 2, 3) !important; }',
        'body { background-image: url(http://evil.test/bg.png) !important; }',
        '@import url(http://evil.test/x.css);',
        // Escapes spell url( out of sight; a font is fetched when the page uses it.
        '@font-face { font-family: evil; src: \\75 rl(http://evil.test/font.woff); }',
        'p { font-family: evil; background-image: image-set("http://evil.test/set.png" 1x); }',
      ].join(' ');
      c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
    });
    const p = await expectBlocked(h, 'http://social.test/');
    await p.role('heading', /blocked/).expectVisible();
    expect(await p.eval(() => getComputedStyle(document.querySelector('h1')!).color)).toBe('rgb(1, 2, 3)');
    await sleep(500);
    expect(h.server.hits('evil.test')).toEqual([]);
  });

  test('a page saved for later is listed, and opened once it is allowed', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('News', ['paper.test'], [policy(BLOCK)])];
      for (const g of c.groups) g.protection = REMINDER;
    });
    const p = await expectBlocked(h, 'http://paper.test/story');
    await p.button('Save for later').click();
    await p.button('Saved').expectVisible();
    await p.button('Saved').expectEnabled(false);
    const later = await h.page('dashboard.html#/later');
    await later.text('paper.test').expectVisible();
    await later.text('not yet available').expectVisible();
    await h.configure((c) => {
      c.groups[0].enabled = false;
    });
    await later.text('available now').expectVisible();
    const opened = await h.newTab(() => later.button('Open', { exact: true }).click());
    await opened.expectReal('paper.test/story');
    await expect.poll(async () => (await h.rpc('later.list')).items.length).toBe(0);
  });

  test('the intervention page refuses to run inside a frame (clickjacking)', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Social', ['social.test'], [policy(BLOCK)])];
    });
    h.server.route('frame.test', {
      body: `<!doctype html><h1 id="real">REAL frame</h1><iframe src="${h.origin}/intervention.html#http://social.test/"></iframe>`,
    });
    await (await h.open('http://frame.test/')).expectReal('frame');
    await sleep(1500);
    const stats = await h.rpc('stats.get', { from: today(), to: today() });
    expect(stats.counters.shown).toBe(0);
  });
});

test.describe('delay', () => {
  test('Continue opens after the wait and lets the whole site through for the visit', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Wait', ['wait.test'], [policy(delay(2))])];
    });
    const p = await expectBlocked(h, 'http://wait.test/a');
    const cont = p.button('Continue', { exact: true });
    await cont.expectEnabled(false);
    await cont.expectEnabled(true, 6000);
    await cont.click();
    await p.expectReal('wait.test/a');
    await expectAllowed(h, 'http://wait.test/b');
    const stats = await h.rpc('stats.get', { from: today(), to: today() });
    expect(stats.counters.proceeded).toBe(1);
  });

  test('an access for the visit ends with the last tab of the site, so opening it again waits again (regression #19)', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.groups = [group('Wait', ['wait.test'], [policy(delay(1))])];
    });
    const passes = async () => (await h.state()).state.grants.filter((g: any) => g.kind === 'pass').length;
    const p = await expectBlocked(h, 'http://wait.test/');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('wait.test/');
    // While a tab shows the site, the visit goes on in other tabs too.
    const other = await expectAllowed(h, 'http://wait.test/other');
    await other.close();
    const again = await expectAllowed(h, 'http://wait.test/again');
    expect(await passes()).toBe(1);
    // Closing every tab of the site ends the visit: the next opening waits again.
    await p.close();
    expect(await passes()).toBe(1);
    await again.close();
    await expect.poll(passes).toBe(0);
    await h.rpc('test.reconcile');
    const q = await expectBlocked(h, 'http://wait.test/');
    // Leaving the site in the same tab ends it too.
    await q.button('Continue', { exact: true }).click(6000);
    await q.expectReal('wait.test/');
    await q.goto('http://elsewhere.test/');
    await expect.poll(passes).toBe(0);
    await h.rpc('test.reconcile');
    await expectBlocked(h, 'http://wait.test/');
  });

  test('a pass for one page leaves the rest of the site restricted', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Wait', ['wait.test'], [policy(delay(1, { grant: { scope: 'page', mode: 'visit' } }))]),
      ];
    });
    const p = await expectBlocked(h, 'http://wait.test/thread/1');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('wait.test/thread/1');
    await expectBlocked(h, 'http://wait.test/thread/2');
  });

  test('a pass for the rule covers its other sites', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group(
          'Wait',
          ['one.test', 'two.test'],
          [policy(delay(1, { grant: { scope: 'group', mode: 'visit' } }))],
        ),
      ];
    });
    const p = await expectBlocked(h, 'http://one.test/');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('one.test/');
    await expectAllowed(h, 'http://two.test/');
  });

  test('a pass for some minutes ends by itself and the open tab is restricted again', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group(
          'Wait',
          ['wait.test'],
          [policy(delay(1, { grant: { scope: 'site', mode: 'minutes', minutes: 1 } }))],
        ),
      ];
    });
    const p = await expectBlocked(h, 'http://wait.test/');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('wait.test/');
    await h.clock.advance(61_000);
    await p.expectIntervention(true, 5000);
  });

  test('automatic continuation and hidden countdown', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Wait', ['auto.test'], [policy(delay(2, { autoContinue: true, hideCountdown: true }))]),
      ];
    });
    const p = await expectBlocked(h, 'http://auto.test/x');
    await p.text('Take a moment…').expectVisible();
    expect(await p.get('.breathe span').text()).toBe('');
    await p.expectReal('auto.test/x', 8000);
  });

  test('the wait grows with every visit of the day, or is random within a range', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Grow', ['grow.test', 'grow-too.test'], [policy(delay(1, { increase: 3 }))]),
        group('Random', ['random.test'], [policy(delay(2, { randomTo: 6 }))]),
      ];
    });
    const seconds = async (url: string) =>
      (await h.rpc('intervention.get', { url })).ticket.step.seconds as number;
    expect(await seconds('http://grow.test/')).toBe(1);
    const p = await expectBlocked(h, 'http://grow.test/');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('grow.test/');
    // The pass covers grow.test for the visit; the next site of the rule waits longer.
    expect(await seconds('http://grow-too.test/')).toBe(4);
    const waits = new Set<number>();
    for (let i = 0; i < 8; i++) waits.add(await seconds('http://random.test/'));
    for (const s of waits) expect(s >= 2 && s <= 6).toBe(true);
    expect(waits.size).toBeGreaterThan(1);
  });

  test('the wait cannot be skipped by calling the background early', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Wait', ['wait.test'], [policy(delay(30))])];
    });
    const m = await h.rpc('intervention.get', { url: 'http://wait.test/' });
    const r = await h.rpc('ticket.answer', { id: m.ticket.id, answer: '' });
    expect(r).toMatchObject({ status: 'error', error: 'ticket.error.notYet' });
    await expectBlocked(h, 'http://wait.test/');
  });
});

test.describe('intention question', () => {
  test('grants the chosen time, records the reason and recalls it on the page', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Video', ['tube.test'], [policy(ask({ choices: [5, 10, 30], maxMinutes: 10 }))])];
    });
    const p = await expectBlocked(h, 'http://tube.test/watch');
    await p.role('heading', 'What do you want to do on tube.test?').expectVisible();
    // Durations above the maximum are not offered.
    await p.role('radio', '30 min').expectCount(0);
    await p.label('Your reason').fill('Reply to a message');
    await p.role('radio', '10 min').click();
    await p.button('Continue for 10 min').click();
    await p.expectReal('tube.test/watch');
    const d = await h.rpc('explain', { url: 'http://tube.test/other' });
    expect(d.groups[0].pass.intention).toBe('Reply to a message');
    expect(d.groups[0].pass.until - (await h.clock.now())).toBeGreaterThan(9 * 60_000);
    // The reason is recalled discreetly during the visit.
    await p.front();
    await p.activity();
    await p.text('Reply to a message', { within: 'webhandbrake-overlay' }).expectVisible();
    const stats = await h.rpc('stats.get', { from: today(), to: today() });
    expect(stats.intentions.map((i: any) => i.text)).toEqual(['Reply to a message']);
  });

  test('going in always takes a reason', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Video', ['tube.test'], [policy(ask())])];
    });
    const p = await expectBlocked(h, 'http://tube.test/');
    await p.button('Continue for 5 min').click();
    await p.text('Please say in a few words what you want to do.').expectVisible();
    // Spaces are not a reason.
    await p.label('Your reason').fill('   ');
    await p.button('Continue for 5 min').click();
    await p.text('Please say in a few words what you want to do.').expectVisible();
    await p.expectIntervention();
    // The background refuses it too, whatever the page sends.
    const m = await h.rpc('intervention.get', { url: 'http://tube.test/' });
    expect(await h.rpc('ticket.answer', { id: m.ticket.id, answer: ' ', minutes: 5 })).toMatchObject({
      status: 'error',
      error: 'ticket.error.intentionRequired',
    });
    await p.label('Your reason').fill('Watch the lecture');
    await p.button('Continue for 5 min').click();
    await p.expectReal('tube.test/');
  });

  test('another duration can be typed, up to the maximum', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Video', ['tube.test'], [policy(ask({ choices: [5, 10], maxMinutes: 45 }))])];
    });
    const p = await expectBlocked(h, 'http://tube.test/');
    await p.label('Your reason').fill('Watch the lecture');
    await p.role('radio', 'Other').click();
    await p.label('How many minutes?').fill('90');
    await p.button('Continue for 45 min').expectVisible();
    await p.label('How many minutes?').fill('25');
    await p.button('Continue for 25 min').click();
    await p.expectReal('tube.test/');
    const d = await h.rpc('explain', { url: 'http://tube.test/other' });
    const left = d.groups[0].pass.until - (await h.clock.now());
    expect(left).toBeGreaterThan(24 * 60_000);
    expect(left).toBeLessThanOrEqual(25 * 60_000);
  });

  test('"Not now" closes the tab', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Video', ['tube.test'], [policy(ask())])];
    });
    const p = await expectBlocked(h, 'http://tube.test/');
    await p.button('Not now — close the tab').click();
    await expect.poll(async () => (await h.tabs()).some((t) => t.url.includes('tube.test'))).toBe(false);
  });

  test('when the chosen time is over, a cool-down blocks the site', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Video', ['tube.test'], [policy(ask({ choices: [5], maxMinutes: 5, cooldownMinutes: 20 }))]),
      ];
    });
    const p = await expectBlocked(h, 'http://tube.test/');
    await p.label('Your reason').fill('One video');
    await p.button('Continue for 5 min').click();
    await p.expectReal('tube.test/');
    await h.clock.advance(5 * 60_000 + 5000);
    await p.expectIntervention(true, 5000);
    await p.role('heading', /The time you chose is over/).expectVisible();
    await p.button(/^Continue/).expectCount(0);
    await h.clock.advance(20 * 60_000);
    await p.reload();
    await p.role('heading', /What do you want to do/).expectVisible();
  });
});

test.describe('challenges', () => {
  test('the code is drawn on a canvas, never in the page, and real typing passes', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Type', ['type.test'], [policy(challenge({ length: 10 }))])];
    });
    const p = await expectBlocked(h, 'http://type.test/');
    await p.get('canvas.challenge-canvas').expectVisible();
    const code = await challengeCode(h, 'http://type.test/');
    expect(code).toHaveLength(10);
    const html = await p.eval(() => document.documentElement.outerHTML);
    expect(html).not.toContain(code);
    await p.label('Characters').type(code);
    await p.button('Continue', { exact: true }).click();
    await p.expectReal('type.test/');
  });

  test('pasted and synthetic input are refused', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Type', ['type.test'], [policy(challenge({ length: 10 }))])];
    });
    const p = await expectBlocked(h, 'http://type.test/');
    const code = await challengeCode(h, 'http://type.test/');
    const input = p.label('Characters');
    await input.waitFor('visible');
    await p.eval((text: string) => {
      const el = document.querySelector<HTMLInputElement>('form input')!;
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      // A script setting the value and announcing it, as an extension or devtools could.
      el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }, code);
    await sleep(300);
    await input.expectValue('');
    await p.button('Continue', { exact: true }).click();
    await p.text('The text does not match. Take your time.').expectVisible();
    expect(await p.isIntervention()).toBe(true);
  });

  test('a screen reader user can type a sentence instead', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Type', ['type.test'], [policy(challenge({ length: 12 }))])];
    });
    const p = await expectBlocked(h, 'http://type.test/');
    await p.button(/screen reader/).click();
    const phrase = await p.get('form blockquote').text();
    expect(phrase).toBe('I am choosing to continue on purpose, and I remember why I set this limit.');
    await p.label('Sentence').type(phrase);
    await p.button('Continue', { exact: true }).click();
    await p.expectReal('type.test/');
  });

  test('a commitment phrase of the user', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group(
          'Type',
          ['type.test'],
          [policy(challenge({ kind: 'phrase', phrase: 'I choose this hour on purpose' }))],
        ),
      ];
    });
    const p = await expectBlocked(h, 'http://type.test/');
    await p.get('form blockquote').expectText('I choose this hour on purpose');
    await p.label('Sentence').type('I choose this hour');
    await p.button('Continue', { exact: true }).click();
    await p.text('The text does not match. Take your time.').expectVisible();
    await p.label('Sentence').fill('I choose this hour on purpose');
    await p.button('Continue', { exact: true }).click();
    await p.expectReal('type.test/');
  });

  test('a small calculation; repeated wrong answers wait a while', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Math', ['math.test'], [policy(challenge({ kind: 'math' }))])];
    });
    const p = await expectBlocked(h, 'http://math.test/');
    const question = await p.get('.pass .num').text();
    const m = question.match(/(-?\d+)\s*([+\-×])\s*(-?\d+)/)!;
    const [a, b] = [Number(m[1]), Number(m[3])];
    const answer = m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b;
    for (let i = 0; i < 5; i++) {
      await p.label('Result').fill(String(answer + 1));
      await p.button('Continue', { exact: true }).click();
      // Each answer is checked before the next one.
      await p.text(/That is not the right answer\.|Too many attempts/).expectVisible();
    }
    await p.label('Result').fill(String(answer));
    await p.button('Continue', { exact: true }).click();
    await p.text('Too many attempts. Try again in a few seconds.').expectVisible();
    expect(await p.isIntervention()).toBe(true);
  });
});

test.describe('several rules on a page', () => {
  test('each rule asks in turn, the strictest first; the page opens once every rule has let it through', async ({
    h,
  }) => {
    await h.configure((c) => {
      c.groups = [
        group('Video', ['tube.test'], [policy(ask())]),
        group('Wait', ['tube.test'], [policy(delay(1))]),
      ];
    });
    const p = await expectBlocked(h, 'http://tube.test/watch');
    await p.role('heading', 'Take a breath.').expectVisible();
    await p.get('.meta').expectText('Wait');
    await p.get('.others').expectText('Another rule applies here too: Video. It asks next');
    await p.button('Continue', { exact: true }).click(6000);
    // The wait opens its own rule only: the question of the other one follows, on the same page.
    await p.role('heading', 'What do you want to do on tube.test?').expectVisible();
    await p.get('.meta').expectText('Video');
    await p.get('.others').expectCount(0);
    expect(await p.isIntervention()).toBe(true);
    await p.label('Your reason').fill('Watch the lecture');
    await p.button('Continue for 5 min').click();
    await p.expectReal('tube.test/watch');
    const d = await h.rpc('explain', { url: 'http://tube.test/watch' });
    expect(d.groups.map((g: any) => [g.name, Boolean(g.pass)])).toEqual([
      ['Video', true],
      ['Wait', true],
    ]);
  });
});

test.describe('in-page interventions', () => {
  test('a filter is applied to the page and the tab can be muted', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [group('Gray', ['gray.test'], [policy(filter('grayscale', { intensity: 80, mute: true }))])];
    });
    const p = await expectAllowed(h, 'http://gray.test/');
    await p.front();
    await expect
      .poll(() =>
        p.eval(() => document.querySelector('style[data-webhandbrake="filter"]')?.textContent ?? ''),
      )
      .toContain('grayscale(80%)');
    await expect
      .poll(() => p.eval(() => getComputedStyle(document.documentElement).filter))
      .toBe('grayscale(0.8)');
    const id = await p.id();
    await expect
      .poll(() =>
        h.control.eval((tabId: number) => chrome.tabs.get(tabId).then((t) => t.mutedInfo?.muted), id),
      )
      .toBe(true);
    // The sound comes back on a page without the filter.
    await p.goto('http://other.test/');
    await expect
      .poll(() =>
        h.control.eval((tabId: number) => chrome.tabs.get(tabId).then((t) => t.mutedInfo?.muted), id),
      )
      .toBe(false);
  });

  test('the filters of every rule add up, also once another rule has let the page through', async ({ h }) => {
    await h.configure((c) => {
      c.groups = [
        group('Gray', ['gray.test'], [policy(filter('grayscale', { intensity: 80 }))]),
        group('Sepia', ['gray.test'], [policy(filter('sepia', { intensity: 50 }))]),
        group('Wait', ['gray.test'], [policy(delay(1))]),
      ];
    });
    const p = await expectBlocked(h, 'http://gray.test/');
    await p.button('Continue', { exact: true }).click(6000);
    await p.expectReal('gray.test/');
    await p.front();
    await expect
      .poll(() => p.eval(() => getComputedStyle(document.documentElement).filter))
      .toBe('grayscale(0.8) sepia(0.5)');
  });
});
