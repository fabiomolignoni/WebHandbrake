import { expect, test } from './harness';
import { BLOCK, challenge, group, policy } from './harness/config';

test('harness: block, real page, challenge through the UI, popup', async ({ h }) => {
  await h.configure((c) => {
    c.groups = [
      group('Block', ['blocked.test'], [policy(BLOCK)]),
      group('Type', ['type.test'], [policy(challenge({ length: 6 }))]),
    ];
  });
  const p = await h.open('http://www.blocked.test/page?x=1');
  await p.expectIntervention();
  await p.expectUrl('#http://www.blocked.test/page?x=1');
  await p.role('heading', /protected/).expectVisible();
  expect(h.server.hits('www.blocked.test')).toEqual([]);
  const free = await h.open('http://free.test/');
  await free.expectReal('free.test/');

  const t = await h.open('http://type.test/a');
  await t.button(/screen reader/).click();
  const phrase = await t.get('form blockquote').text();
  await t.label('Sentence').type(phrase);
  await t.button('Continue', { exact: true }).click();
  await t.expectReal('type.test/a');

  const popup = await h.popup(p);
  await popup.text('blocked.test', { exact: true }).expectVisible();
  await popup.text('Blocked', { exact: true }).expectVisible();
});
