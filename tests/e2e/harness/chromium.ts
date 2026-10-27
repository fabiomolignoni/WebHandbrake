/** Chromium backend: Playwright over the Chrome DevTools Protocol, with the unpacked extension loaded. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, chromium, type ElementHandle, type Page, type Worker } from '@playwright/test';
import type { BrowserDriver, LaunchOptions, TabDriver } from './driver';
import { cachedBrowsers } from './firefox';
import { pageQuery, type WireQuery } from './queries';

const QUERY = pageQuery.toString();

/** The ID Chromium gives an unpacked extension: derived from the SHA-256 of its directory. */
function unpackedExtensionId(dir: string): string {
  const hex = createHash('sha256').update(realpathSync(dir)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
}

/**
 * The browser's own DevTools endpoint (`--remote-debugging-port`): the Extensions domain, which
 * installs and removes extensions, is not available to the session of a page.
 */
async function browserSession(profile: string) {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  const [port, path] = readFileSync(file, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('cannot reach the DevTools endpoint of the browser'));
  });
  let next = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message}`));
    else p.resolve(m.result);
  };
  return {
    send: (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

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
  async select(q: WireQuery, value: string) {
    const el = await this.element(q);
    await el.selectOption(value, { timeout: 5000 });
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
  async viewport(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
  }
  async inject(source: string) {
    // The DevTools protocol evaluates outside the page's Content-Security-Policy.
    await this.page.evaluate(source);
  }
}

export async function launchChromium(opts: LaunchOptions): Promise<BrowserDriver> {
  const context: BrowserContext = await chromium.launchPersistentContext(opts.profile ?? '', {
    channel: 'chromium',
    // Playwright's own Chromium by default (branded Chrome no longer loads unpacked extensions).
    executablePath: process.env.CHROMIUM_BIN || cachedBrowsers().chromium || undefined,
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 900 },
    // Like a normal browser: Playwright turns the back/forward cache off by default.
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    args: [
      `--disable-extensions-except=${opts.extension}`,
      `--load-extension=${opts.extension}`,
      // Every host is served by the local test server, except the browser's own update service: its
      // checks (sent by Chromium 156 despite --disable-component-update) would appear among the
      // requests the extension must not make. The first matching rule applies.
      `--host-resolver-rules=MAP update.googleapis.com ~NOTFOUND, MAP * 127.0.0.1:${opts.port}`,
      // The browser's own time queries would appear among those requests too.
      '--disable-features=NetworkTimeServiceQuerying',
      // The Extensions domain of the DevTools protocol, to install the extension again (reset).
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
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
  // Known in advance: under load, the service worker may register before Playwright sees it.
  const origin = `chrome-extension://${unpackedExtensionId(opts.extension)}`;
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
  // Without a handler, Playwright answers "Leave site?" with Leave and dismisses the other dialogs.
  if (opts.stayOnPages) context.on('dialog', (d) => void d.dismiss().catch(() => undefined));

  let helper: Page | null = null;
  const ready = (p: Page) => p.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)).catch(() => false);
  const helperPage = async () => {
    if (helper && !helper.isClosed() && (await ready(helper))) return helper;
    if (helper && !helper.isClosed()) await helper.close().catch(() => undefined);
    helper = await context.newPage();
    for (let i = 0; i < 75; i++) {
      await helper.goto(`${origin}/test.html`).catch(() => undefined);
      if (await ready(helper)) break;
      // The extension is reloading.
      await new Promise((r) => setTimeout(r, 200));
    }
    return helper;
  };

  // The extension is loaded once one of its pages can use the extension APIs.
  if (!(await ready(await helperPage()))) {
    await context.close().catch(() => undefined);
    throw new Error(`the extension did not load (${origin})`);
  }

  /** Changes the extension as the person does on the browser's page of the extension. */
  const configureExtension = async (update: Record<string, unknown>) => {
    const page = await context.newPage();
    try {
      await page.goto(`chrome://extensions/?id=${origin.slice('chrome-extension://'.length)}`);
      await page.evaluate(
        async ([id, u]) => {
          const dp = (chrome as any).developerPrivate;
          const done = (resolve: () => void, reject: (e: Error) => void) => () => {
            const e = chrome.runtime.lastError;
            if (e) reject(new Error(e.message));
            else resolve();
          };
          // Without the developer mode, Chromium turns off the unpacked extension it reloads.
          await new Promise<void>((resolve, reject) =>
            dp.updateProfileConfiguration({ inDeveloperMode: true }, done(resolve, reject)),
          );
          await new Promise<void>((resolve, reject) =>
            dp.updateExtensionConfiguration({ extensionId: id, ...u }, done(resolve, reject)),
          );
        },
        [origin.slice('chrome-extension://'.length), update] as const,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
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
    async reset() {
      if (!opts.profile) throw new Error('reset: launch with a profile');
      // A window keeps one tab: a blank one is opened before the others are closed.
      const blank = await context.newPage();
      for (const p of context.pages()) if (p !== blank) await p.close().catch(() => undefined);
      tabs.clear();
      helper = null;
      errors.length = 0;
      const cdp = await browserSession(opts.profile);
      try {
        const id = origin.slice('chrome-extension://'.length);
        // An extension of the command line cannot be removed: loaded again, it is an unpacked one.
        await cdp.send('Extensions.uninstall', { id }).catch(async () => {
          await cdp.send('Extensions.loadUnpacked', { path: opts.extension });
          await cdp.send('Extensions.uninstall', { id });
        });
        await cdp.send('Extensions.loadUnpacked', { path: opts.extension });
      } finally {
        cdp.close();
      }
    },
    async allowPrivateWindows() {
      await configureExtension({ incognitoAccess: true });
      // The extension starts again: its pages are closed.
      helper = null;
    },
    async withholdSiteAccess() {
      await configureExtension({ hostAccess: 'ON_CLICK' });
    },
    async stopBackground() {
      const page = await helperPage();
      const cdp = await context.newCDPSession(page);
      const { targetInfos } = await cdp.send('Target.getTargets');
      // The background of the private windows too, when they are open.
      const workers = targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith(origin));
      for (const sw of workers) await cdp.send('Target.closeTarget', { targetId: sw.targetId });
      await cdp.detach().catch(() => undefined);
      return workers.length > 0;
    },
    async close() {
      await context.close().catch(() => undefined);
    },
  };
  return driver;
}
