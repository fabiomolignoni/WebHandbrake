/**
 * Playwright Test fixtures of the end-to-end suite. Every test gets `h`, a fresh browser of the
 * project (chromium or firefox) with the test build of the extension. After the test, any error
 * seen in the extension fails it; on failure, screenshots of every tab are attached.
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

export const test = base.extend<Fixtures>({
  launch: [{}, { option: true }],
  h: async ({ browserName, launch }, use, testInfo) => {
    const h = await Harness.launch(browserName as BrowserName, launch);
    let errors: string[] = [];
    try {
      await use(h);
    } finally {
      errors = await h.collectErrors().catch((e) => [`cannot collect errors: ${e}`]);
      if (testInfo.status !== testInfo.expectedStatus) {
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
      await h.close();
    }
    expect(errors, 'errors in the extension (background, pages, content scripts)').toEqual([]);
  },
});
