/**
 * Firefox backend: geckodriver with a hybrid session.
 *
 * - WebDriver BiDi drives tabs, navigation and scripts without changing the selected tab.
 * - WebDriver classic gives real (trusted) clicks and keystrokes, also on moz-extension pages:
 *   Firefox's BiDi input module refuses them on extension pages ("privileged scope"), WebDriver
 *   classic accepts them with geckodriver --allow-system-access.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserDriver, LaunchOptions, TabDriver } from './driver';
import { pageQuery, type WireQuery } from './queries';
import { elementId, elementRef, KEYS, WebDriverError, WebDriverSession } from './webdriver';

const QUERY = pageQuery.toString();
/** Fixed internal UUID of the extension (pref extensions.webextensions.uuids). */
export const FIREFOX_UUID = '6b1f3c2e-8a4d-4e5f-9c1b-7d2e3f4a5b6c';
export const GECKO_ID = 'webhandbrake@webhandbrake.org';

/** Paths written by scripts/browsers.mjs. */
export function cachedBrowsers(): Record<string, string> {
  const file = join(process.cwd(), '.cache/browsers/paths.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export function firefoxBinaries(): { firefox: string; geckodriver: string } {
  const c = cachedBrowsers();
  const firefox = process.env.FIREFOX_BIN || c.firefox;
  const geckodriver = process.env.GECKODRIVER_BIN || c.geckodriver || 'geckodriver';
  if (!firefox)
    throw new Error('Firefox not found: run `npm run browsers` or set FIREFOX_BIN (and GECKODRIVER_BIN)');
  return { firefox, geckodriver };
}

class FirefoxTab implements TabDriver {
  closed = false;
  constructor(
    private readonly s: FirefoxSession,
    readonly context: string,
  ) {}

  isClosed() {
    return this.closed;
  }
  async url() {
    const tree = await this.s.wd.bidi('browsingContext.getTree', { root: this.context, maxDepth: 0 });
    return tree.contexts[0]?.url ?? '';
  }
  async navigate(url: string) {
    await this.s.wd
      .bidi('browsingContext.navigate', { context: this.context, url, wait: 'none' })
      .catch(() => {});
  }
  async reload() {
    await this.s.wd.bidi('browsingContext.reload', { context: this.context, wait: 'none' }).catch(() => {});
  }
  async back() {
    await Promise.race([
      this.s.wd.bidi('browsingContext.traverseHistory', { context: this.context, delta: -1 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.s.wd.bidi('browsingContext.close', { context: this.context }).catch(() => {});
  }
  async activate() {
    // BiDi's browsingContext.activate refuses extension pages; WebDriver classic selects any tab.
    await this.s.focus(this.context);
  }
  async evaluate<R>(fnSource: string, args: unknown[]): Promise<R> {
    const r = await this.s.wd
      .bidi('script.callFunction', {
        functionDeclaration: `async function (json) { const v = await (${fnSource})(...JSON.parse(json)); return v === undefined ? '\\u0000undefined' : JSON.stringify(v); }`,
        arguments: [{ type: 'string', value: JSON.stringify(args) }],
        target: { context: this.context },
        awaitPromise: true,
        resultOwnership: 'none',
      })
      .catch((e) => {
        // The tab is gone (closed by the extension or the page).
        if (e instanceof WebDriverError && e.error === 'no such frame') this.closed = true;
        throw e;
      });
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'exception');
    const v = r.result?.value as string | undefined;
    if (v === undefined || v === '\u0000undefined') return undefined as R;
    return JSON.parse(v) as R;
  }
  private async element(q: WireQuery): Promise<string> {
    await this.s.focus(this.context);
    const ref = await this.s.wd.classic('POST', '/execute/sync', {
      script: `return (${QUERY}).apply(null, arguments)`,
      args: [q, 'element'],
    });
    const id = elementId(ref);
    if (!id) throw new Error('element not found');
    return id;
  }
  /**
   * WebDriver scrolls only an element outside the viewport, and only to its bottom edge, so a
   * sticky bar can still cover it (the dashboard's action bar, its navigation on a phone): an
   * element outside the viewport, or that a sticky or fixed element covers at its centre, is
   * centred first. An option is clicked through its list, which is centred instead.
   */
  private async uncover(id: string) {
    await this.s.wd.classic('POST', '/execute/sync', {
      script: `const list = arguments[0].closest('select');
        const el = list ?? arguments[0];
        const r = el.getBoundingClientRect();
        let top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          return;
        }
        if (top === el || el.contains(top)) return;
        for (; top; top = top.parentElement) {
          if (['sticky', 'fixed'].includes(getComputedStyle(top).position)) {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            return;
          }
        }`,
      args: [elementRef(id)],
    });
  }
  async click(q: WireQuery) {
    const id = await this.element(q);
    await this.uncover(id);
    await this.s.wd.classic('POST', `/element/${id}/click`);
  }
  async type(q: WireQuery, text: string, clear: boolean) {
    const id = await this.element(q);
    if (clear) await this.s.wd.classic('POST', `/element/${id}/clear`);
    // A new line is the Enter key, as in Playwright.
    await this.s.wd.classic('POST', `/element/${id}/value`, { text: text.replace(/\n/g, KEYS.Enter) });
  }
  async select(q: WireQuery, value: string) {
    await this.s.focus(this.context);
    // Clicking an <option> selects it, as a user choosing in the list.
    const ref = await this.s.wd.classic('POST', '/execute/sync', {
      script: `const el = (${QUERY}).apply(null, [arguments[0], 'element']); return el ? [...el.options].find((o) => o.value === arguments[1]) ?? null : null;`,
      args: [q, value],
    });
    const id = elementId(ref);
    if (!id) throw new Error('option not found');
    await this.uncover(id);
    await this.s.wd.classic('POST', `/element/${id}/click`);
  }
  async press(key: string) {
    await this.s.focus(this.context);
    const parts = key.split('+');
    const codes = parts.map((p) => KEYS[p] ?? p);
    const actions = [
      ...codes.map((value) => ({ type: 'keyDown', value })),
      ...codes.reverse().map((value) => ({ type: 'keyUp', value })),
    ];
    await this.s.wd.classic('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions }] });
  }
  async mouse(x: number, y: number) {
    await this.s.focus(this.context);
    await this.s.wd.classic('POST', '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport', duration: 0 },
          ],
        },
      ],
    });
  }
  async viewport(width: number, height: number) {
    try {
      await this.s.wd.bidi('browsingContext.setViewport', {
        context: this.context,
        viewport: { width, height },
      });
    } catch {
      // Refused on extension pages: size the window instead (Firefox keeps a minimum width).
      await this.s.focus(this.context);
      const inner = await this.evaluate<[number, number]>(
        '() => [window.outerWidth - window.innerWidth, window.outerHeight - window.innerHeight]',
        [],
      );
      await this.s.wd.classic('POST', '/window/rect', { width: width + inner[0], height: height + inner[1] });
    }
  }
  async inject(source: string) {
    const r = await this.s.wd.bidi('script.evaluate', {
      expression: `${source}\n;void 0`,
      target: { context: this.context },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'exception');
  }
  async screenshot(path: string) {
    const { writeFile } = await import('node:fs/promises');
    const r = await this.s.wd.bidi('browsingContext.captureScreenshot', {
      context: this.context,
      origin: 'document',
    });
    await writeFile(path, Buffer.from(r.data, 'base64'));
  }
}

class FirefoxSession {
  current: string | null = null;
  readonly tabs = new Map<string, FirefoxTab>();
  constructor(readonly wd: WebDriverSession) {}

  tab(context: string) {
    let t = this.tabs.get(context);
    if (!t) {
      t = new FirefoxTab(this, context);
      this.tabs.set(context, t);
    }
    return t;
  }

  /** WebDriver classic acts on the current window: switching selects the tab, like a user would. */
  async focus(context: string) {
    if (this.current === context) {
      // The tab may have been switched away from by other means: switching again is cheap.
      const handle = await this.wd.classic<string>('GET', '/window').catch(() => null);
      if (handle === context) return;
    }
    await this.wd.classic('POST', '/window', { handle: context });
    this.current = context;
  }

  async contexts(): Promise<{ context: string; url: string }[]> {
    const tree = await this.wd.bidi('browsingContext.getTree', { maxDepth: 0 });
    return tree.contexts.map((c: { context: string; url: string }) => ({ context: c.context, url: c.url }));
  }
}

export async function launchFirefox(opts: LaunchOptions): Promise<BrowserDriver> {
  const bins = firefoxBinaries();
  const prefs: Record<string, unknown> = {
    // Every web request goes to the local test server.
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': opts.port,
    'network.proxy.allow_hijacking_localhost': true,
    'network.proxy.no_proxies_on': '',
    'dom.security.https_first': false,
    'dom.security.https_first_pbm': false,
    'dom.security.https_only_mode': false,
    'network.captive-portal-service.enabled': false,
    'network.connectivity-service.enabled': false,
    'browser.tabs.warnOnClose': false,
    'browser.sessionstore.resume_from_crash': false,
    // A fixed internal UUID gives a known moz-extension:// origin, kept when the add-on is
    // installed again (reset): its storage still goes with it.
    'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: FIREFOX_UUID }),
    'extensions.webextensions.keepUuidOnUninstall': true,
    // Optional permissions requested with a real click are granted without a door hanger.
    'extensions.webextOptionalPermissionPrompts': false,
    'extensions.background.idle.timeout': opts.backgroundIdleMs ?? 30_000,
    'ui.prefersReducedMotion': 0,
    ...(opts.stayOnPages ? { 'dom.disable_beforeunload': false } : {}),
  };
  const wd = await WebDriverSession.start(bins.geckodriver, {
    browserName: 'firefox',
    webSocketUrl: true,
    pageLoadStrategy: 'none',
    unhandledPromptBehavior: opts.stayOnPages ? { default: 'ignore', beforeUnload: 'dismiss' } : 'ignore',
    'moz:firefoxOptions': {
      binary: bins.firefox,
      args: process.env.HEADED ? [] : ['-headless'],
      prefs,
    },
  });
  const s = new FirefoxSession(wd);
  const install = () => wd.classic('POST', '/moz/addon/install', { path: opts.extension, temporary: true });
  const errors: string[] = [];
  try {
    await wd.classic('POST', '/window/rect', { width: 1280, height: 900 }).catch(() => undefined);
    await install();
  } catch (e) {
    await wd.close();
    throw e;
  }
  const origin = `moz-extension://${FIREFOX_UUID}`;
  let control: FirefoxTab | null = null;

  const driver: BrowserDriver = {
    name: 'firefox',
    origin,
    errors,
    async newTab(url, o = {}) {
      const { context } = await wd.bidi('browsingContext.create', {
        type: 'tab',
        background: Boolean(o.background),
      });
      const tab = s.tab(context);
      await tab.navigate(url);
      return tab;
    },
    async control() {
      const ready = (t: FirefoxTab) =>
        t
          .evaluate<boolean>(
            '() => document.readyState === "complete" && location.protocol === "moz-extension:" && Boolean(globalThis.browser?.runtime?.id)',
            [],
          )
          .catch(() => false);
      if (control && !control.closed && (await ready(control))) return control;
      if (control) await control.close();
      const { context } = await wd.bidi('browsingContext.create', { type: 'tab', background: true });
      control = s.tab(context);
      for (let i = 0; i < 75; i++) {
        await control.navigate(`${origin}/test.html`);
        await new Promise((r) => setTimeout(r, 200));
        if (await ready(control)) break;
      }
      return control;
    },
    async waitForNewTab(trigger) {
      const before = new Set((await s.contexts()).map((c) => c.context));
      await trigger();
      for (let i = 0; i < 150; i++) {
        const fresh = (await s.contexts()).find((c) => !before.has(c.context));
        if (fresh) return s.tab(fresh.context);
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('no new tab was opened');
    },
    async tabs() {
      const ctx = await s.contexts();
      const live = new Set(ctx.map((c) => c.context));
      for (const [id, t] of s.tabs) if (!live.has(id)) t.closed = true;
      return ctx.map((c) => ({ tab: s.tab(c.context), url: c.url }));
    },
    async stopBackground() {
      return false;
    },
    async reset() {
      // A window keeps one tab: a blank one is opened before the others are closed.
      const old = await s.contexts();
      const { context } = await wd.bidi('browsingContext.create', { type: 'tab' });
      for (const c of old) await wd.bidi('browsingContext.close', { context: c.context }).catch(() => {});
      s.tabs.clear();
      s.current = null;
      control = null;
      errors.length = 0;
      await s.focus(context);
      await wd.classic('POST', '/window/rect', { width: 1280, height: 900 }).catch(() => undefined);
      await wd.classic('POST', '/moz/addon/uninstall', { id: GECKO_ID });
      await install();
    },
    async close() {
      await wd.close();
    },
  };
  return driver;
}

export { WebDriverError };
