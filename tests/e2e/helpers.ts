/** Assertions shared by the scenarios. */

import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, type Harness, type Tab } from './harness';

/** Opens a URL and expects the intervention page, without any request to the site. */
export async function expectBlocked(h: Harness, url: string): Promise<Tab> {
  const u = new URL(url);
  const seen = h.server.hits(u.hostname).length;
  const tab = await h.open(url);
  await tab.expectIntervention();
  // Rendered once the background has given the page its model (and counted it).
  await tab.get('main.intervention:not([aria-busy])').waitFor('attached');
  expect(h.server.hits(u.hostname).slice(seen), `no request to ${url}`).toEqual([]);
  return tab;
}

/** Opens a URL and expects the real page of the site. */
export async function expectAllowed(h: Harness, url: string): Promise<Tab> {
  const tab = await h.open(url);
  const u = new URL(url);
  await tab.expectReal(`${u.hostname}${u.pathname}${u.search}`);
  return tab;
}

/** Keeps a page "in use" (focused, with input) until a condition holds or the time is up. */
export async function useUntil(tab: Tab, done: () => Promise<boolean>, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  await tab.front();
  while (Date.now() - t0 < timeoutMs) {
    if (await done()) break;
    await tab.activity();
    await new Promise((r) => setTimeout(r, 400));
  }
  return Date.now() - t0;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens a part of the rule editor from its progress bar. A part with unsaved
 * changes or a problem adds that to its name, so the name is matched from its start.
 */
export async function openPart(p: Tab, part: string): Promise<void> {
  const name = new RegExp(`^${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  await p.button(name, { within: '.editor-steps' }).click();
  await p.get('.editor-steps [aria-current="step"]').expectText(name);
}

/** The code of the challenge shown for a URL, read from the background tickets (never in the page). */
export async function challengeCode(h: Harness, url: string): Promise<string> {
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

/** The colour of one pixel of a tab's screenshot, as [r, g, b] (8-bit PNG, RGB or RGBA). */
export async function pixel(tab: Tab, path: string, x: number, y: number): Promise<number[]> {
  await tab.screenshot(path);
  const png = await readFile(path);
  const width = png.readUInt32BE(16);
  const channels = png[25] === 6 ? 4 : 3;
  if (png[24] !== 8 || (png[25] !== 2 && png[25] !== 6)) throw new Error('unexpected PNG format');
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const data = inflateSync(Buffer.concat(parts));
  // Undoes the row filters down to the row asked for.
  const stride = width * channels;
  let prev = Buffer.alloc(stride);
  for (let row = 0; row <= y; row++) {
    const type = data[row * (stride + 1)];
    const line = Buffer.from(data.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const add = [0, a, b, (a + b) >> 1, paeth][type];
      line[i] = (line[i] + add) & 0xff;
    }
    prev = line;
  }
  return [...prev.subarray(x * channels, x * channels + 3)];
}
