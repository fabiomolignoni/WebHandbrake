/**
 * Playwright Test fixtures of the end-to-end suite. Every test gets `h`, a browser of the project
 * (chromium or firefox) with the test build of the extension as just installed. After the test,
 * any error seen in the extension fails it; on failure, screenshots of every tab are attached.
 *
 * A browser takes a while to launch: a worker keeps its browser for the next test, which starts
 * with every tab closed and the extension installed again (`Harness.reuse`). A test with launch
 * options of its own, or after a failure, gets a browser of its own.
 */

import { test as base, expect } from '@playwright/test';
import type { BrowserName, LaunchOptions } from './driver';
import { Harness } from './harness';

export type { Locator, Tab } from './harness';
export { Harness, tempProfile } from './harness';
export { expect };

type Fixtures = {
  h: Harness;
  /** Launch options for the test (set with test.use). */
  launch: Partial<LaunchOptions>;
};

type WorkerFixtures = {
  /** The browser that the worker's last test left for the next one. */
  idle: { h: Harness | null };
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  launch: [{}, { option: true }],
  idle: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a fixture uses from its first parameter.
    async ({}, use) => {
      const slot: { h: Harness | null } = { h: null };
      await use(slot);
      await slot.h?.close();
    },
    { scope: 'worker' },
  ],
  h: async ({ browserName, launch, idle }, use, testInfo) => {
    const own = Object.keys(launch).length > 0;
    let h: Harness | null = null;
    if (!own && idle.h) {
      const prev = idle.h;
      idle.h = null;
      h = await Harness.reuse(prev).catch(async () => {
        await prev.close();
        return null;
      });
    }
    h ??= await Harness.launch(browserName as BrowserName, launch);
    let errors: string[] = [];
    try {
      await use(h);
    } finally {
      errors = await h.collectErrors().catch((e) => [`cannot collect errors: ${e}`]);
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) {
        await h.screenshots(testInfo.outputDir).catch(() => undefined);
        await testInfo.attach('requests.json', {
          body: JSON.stringify(
            h.server.requests.map((r) => `${r.method} ${r.host}${r.path}`),
            null,
            2,
          ),
          contentType: 'application/json',
        });
        await testInfo
          .attach('background-state.json', {
            body: JSON.stringify(await h.state().catch(() => null), null, 2),
            contentType: 'application/json',
          })
          .catch(() => undefined);
      }
      if (!own && !failed && errors.length === 0) idle.h = h;
      else await h.close();
    }
    expect(errors, 'errors in the extension (background, pages, content scripts)').toEqual([]);
  },
});
