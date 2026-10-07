/** Assertions shared by the scenarios. */

import { expect, type Harness, type Tab } from './harness';

/** Opens a URL and expects the intervention page, without any request to the site (ENF-01). */
export async function expectBlocked(h: Harness, url: string): Promise<Tab> {
  const u = new URL(url);
  const seen = h.server.hits(u.hostname).length;
  const tab = await h.open(url);
  await tab.expectIntervention();
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
