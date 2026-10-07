/** Chromium backend: Playwright over the Chrome DevTools Protocol, with the unpacked extension loaded. */

import { type BrowserContext, chromium, type ElementHandle, type Page, type Worker } from '@playwright/test';
import type { BrowserDriver, LaunchOptions, TabDriver } from './driver';
import { cachedBrowsers } from './firefox';
import { pageQuery, type WireQuery } from './queries';

const QUERY = pageQuery.toString();

function expr(fnSource: string, args: unknown[]): string {
  return `(${fnSource})(${args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(', ')})`;
}

class ChromiumTab implements TabDriver {
  constructor(readonly page: Page) {}

  isClosed() {
    return this.page.isClosed();
  }
  async url() {
    return this.page.url();
  }
  async navigate(url: string) {
    // Commit is enough: blocked navigations end on the intervention page or fail on purpose.
    await this.page.goto(url, { waitUntil: 'commit', timeout: 15_000 }).catch(() => undefined);
  }
  async reload() {
    await this.page.reload({ waitUntil: 'commit', timeout: 15_000 }).catch(() => undefined);
  }
  async back() {
    await this.page.goBack({ waitUntil: 'commit', timeout: 15_000 }).catch(() => undefined);
  }
  async close() {
    if (!this.page.isClosed()) await this.page.close().catch(() => undefined);
  }
  async activate() {
    await this.page.bringToFront();
  }
  evaluate<R>(fnSource: string, args: unknown[]): Promise<R> {
    return this.page.evaluate(expr(fnSource, args)) as Promise<R>;
  }
  private async element(q: WireQuery): Promise<ElementHandle<Element>> {
    const handle = await this.page.evaluateHandle(expr(QUERY, [q, 'element']));
    const el = handle.asElement();
    if (!el) throw new Error('element not found');
    return el as ElementHandle<Element>;
  }
  async click(q: WireQuery) {
    const el = await this.element(q);
    await el.click({ timeout: 5000 });
  }
  async type(q: WireQuery, text: string, clear: boolean) {
    const el = await this.element(q);
    await el.focus();
    if (clear) {
      await el.evaluate((e) => (e as HTMLInputElement).select?.());
      await this.page.keyboard.press('Backspace');
    }
    await this.page.keyboard.type(text);
  }
  async press(key: string) {
    await this.page.keyboard.press(key);
  }
  async mouse(x: number, y: number) {
    await this.page.mouse.move(x, y);
  }
  async screenshot(path: string) {
    await this.page.screenshot({ path, fullPage: true });
  }
}

export async function launchChromium(opts: LaunchOptions): Promise<BrowserDriver> {
  const context: BrowserContext = await chromium.launchPersistentContext(opts.profile ?? '', {
    channel: 'chromium',
    // Playwright's own Chromium by default (branded Chrome no longer loads unpacked extensions).
    executablePath: process.env.CHROMIUM_BIN || cachedBrowsers().chromium || undefined,
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 900 },
    // Like a normal browser: Playwright turns the back/forward cache off by default (ENF-10).
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    args: [
      `--disable-extensions-except=${opts.extension}`,
      `--load-extension=${opts.extension}`,
      // Every host is served by the local test server.
      `--host-resolver-rules=MAP * 127.0.0.1:${opts.port}`,
    ],
  });
  const errors: string[] = [];
  const tabs = new Map<Page, ChromiumTab>();
  const wrap = (p: Page) => {
    let t = tabs.get(p);
    if (!t) {
      t = new ChromiumTab(p);
      tabs.set(p, t);
    }
    return t;
  };

  const watchWorker = (w: Worker) => {
    w.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[service worker] ${m.text()}`);
    });
  };
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  // URL.origin is "null" for chrome-extension: URLs in Node.
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  for (const w of context.serviceWorkers()) watchWorker(w);
  context.on('serviceworker', watchWorker);

  const watchPage = (p: Page) => {
    p.on('pageerror', (e) => {
      if (p.url().startsWith(origin)) errors.push(`[${p.url()}] ${e.message}`);
    });
    p.on('console', (m) => {
      if (m.type() === 'error' && p.url().startsWith(origin)) errors.push(`[${p.url()}] ${m.text()}`);
    });
  };
  for (const p of context.pages()) watchPage(p);
  context.on('page', watchPage);

  let helper: Page | null = null;
  const helperPage = async () => {
    if (!helper || helper.isClosed()) {
      helper = await context.newPage();
      for (let i = 0; i < 50; i++) {
        const ok = await helper
          .goto(`${origin}/test.html`)
          .then(() => true)
          .catch(() => false);
        if (ok) break;
        // The extension is reloading.
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return helper;
  };

  const driver: BrowserDriver = {
    name: 'chromium',
    origin,
    errors,
    async newTab(url, o = {}) {
      if (o.background) {
        const h = await helperPage();
        return driver.waitForNewTab(() =>
          h.evaluate((u) => chrome.tabs.create({ url: u, active: false }), url),
        );
      }
      const page = await context.newPage();
      const tab = wrap(page);
      await tab.navigate(url);
      return tab;
    },
    async control() {
      return wrap(await helperPage());
    },
    async waitForNewTab(trigger) {
      const next = context.waitForEvent('page', { timeout: 15_000 });
      await trigger();
      return wrap(await next);
    },
    async tabs() {
      return context.pages().map((p) => ({ tab: wrap(p), url: p.url() }));
    },
    async stopBackground() {
      const page = await helperPage();
      const cdp = await context.newCDPSession(page);
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(origin));
      if (sw) await cdp.send('Target.closeTarget', { targetId: sw.targetId });
      await cdp.detach().catch(() => undefined);
      return Boolean(sw);
    },
    async close() {
      await context.close().catch(() => undefined);
    },
  };
  return driver;
}
