/**
 * Browser-independent harness of the end-to-end suite: the same scenario runs in Chromium and in
 * Firefox with the test build of the extension (dist-test/), a local web server and real input.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { launchChromium } from './chromium';
import type { BrowserDriver, BrowserName, LaunchOptions, TabDriver } from './driver';
import { launchFirefox } from './firefox';
import { describeQuery, type ElementInfo, pageQuery, type Query, type TextMatch, toWire } from './queries';
import { TestServer } from './server';

const QUERY = pageQuery.toString();
const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT = 10_000;
/** Poll intervals of the assertions (Playwright's default starts at 100 ms and grows to 1 s). */
const POLL = [50, 100, 150, 250];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function extensionDir(browser: BrowserName) {
  return join(process.cwd(), 'dist-test', browser === 'chromium' ? 'chrome' : 'firefox');
}

/** Retries an action until it succeeds or the time is up (pages navigate, elements re-render). */
async function retry<T>(what: string, fn: () => Promise<T>, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) break;
    await sleep(Math.min(50 * 2 ** i, 250));
  }
  throw new Error(`${what}: ${last instanceof Error ? last.message : String(last)}`);
}

export class Locator {
  constructor(
    readonly tab: Tab,
    readonly query: Query,
  ) {}

  toString() {
    return describeQuery(this.query);
  }

  /** Information about the element (or the first match), retried while the page is navigating. */
  info(attr?: string): Promise<ElementInfo> {
    return retry(
      `query ${this}`,
      () => this.tab.driver.evaluate<ElementInfo>(QUERY, [toWire(this.query), 'info', attr]),
      5000,
    );
  }

  async waitFor(
    state: 'visible' | 'hidden' | 'enabled' | 'attached' | 'detached',
    timeout = DEFAULT_TIMEOUT,
  ) {
    const end = Date.now() + timeout;
    let info: ElementInfo | null = null;
    while (Date.now() < end) {
      info = await this.info().catch(() => null);
      if (info) {
        const ok =
          state === 'visible'
            ? info.visible
            : state === 'hidden'
              ? !info.visible
              : state === 'enabled'
                ? info.visible && info.enabled
                : state === 'attached'
                  ? info.count > 0
                  : info.count === 0;
        if (ok) return info;
      }
      await sleep(50);
    }
    throw new Error(`${this} did not become ${state} in ${timeout} ms (last: ${JSON.stringify(info)})`);
  }

  /** Clicks with real input once the element is visible and enabled. */
  async click(timeout = DEFAULT_TIMEOUT) {
    await this.waitFor('enabled', timeout);
    await retry(`click ${this}`, () => this.tab.driver.click(toWire(this.query)), timeout);
    await sleep(50);
  }

  /** Replaces the content of a field by typing (real keystrokes). */
  async fill(text: string) {
    await this.waitFor('enabled');
    await retry(`fill ${this}`, () => this.tab.driver.type(toWire(this.query), text, true));
  }

  /** Types at the end of a field (real keystrokes). */
  async type(text: string) {
    await this.waitFor('enabled');
    await retry(`type ${this}`, () => this.tab.driver.type(toWire(this.query), text, false));
  }

  /**
   * Pastes text into the element with the real clipboard: the text is copied with Ctrl+C from a
   * temporary text area of the page, then pasted with Ctrl+V (trusted events, as a user does).
   */
  async paste(text: string) {
    await this.waitFor('enabled');
    await this.tab.eval((t: string) => {
      const area = document.createElement('textarea');
      area.id = '__whb_clip';
      area.value = t;
      area.style.cssText =
        'position: fixed; top: 0; left: 0; width: 200px; height: 60px; z-index: 2147483647';
      document.body.appendChild(area);
      area.focus();
      area.select();
    }, text);
    await this.tab.driver.press('Control+c');
    await this.tab.eval(() => document.getElementById('__whb_clip')?.remove());
    await this.tab.driver.click(toWire(this.query));
    await this.tab.driver.press('Control+v');
  }

  /** Chooses an option (by value) of a native <select>. */
  async select(value: string) {
    await this.waitFor('enabled');
    await retry(`select ${this}`, () => this.tab.driver.select(toWire(this.query), value));
  }

  /** Focuses the element and presses a key. */
  async press(key: string) {
    await this.waitFor('visible');
    await this.tab.driver.evaluate(
      `(q, query) => { const el = (${QUERY})(q, 'element'); el && el.focus(); }`,
      [toWire(this.query)],
    );
    await this.tab.driver.press(key);
  }

  async text() {
    return (await this.info()).text;
  }
  async texts(): Promise<string[]> {
    return retry(`texts ${this}`, () =>
      this.tab.driver.evaluate<string[]>(QUERY, [toWire(this.query), 'texts']),
    );
  }
  async value() {
    return (await this.info()).value;
  }
  async count() {
    return (await this.info()).count;
  }
  async visible() {
    return (await this.info()).visible;
  }
  async enabled() {
    const i = await this.info();
    return i.count > 0 && i.enabled;
  }
  async checked() {
    return (await this.info()).checked;
  }
  async attr(name: string) {
    return (await this.info(name)).attr;
  }

  // Web-first assertions: retried until they pass or time out.
  expectVisible(timeout = DEFAULT_TIMEOUT) {
    return expect
      .poll(() => this.visible(), { timeout, intervals: POLL, message: `${this} visible` })
      .toBe(true);
  }
  expectHidden(timeout = DEFAULT_TIMEOUT) {
    return expect
      .poll(() => this.visible(), { timeout, intervals: POLL, message: `${this} hidden` })
      .toBe(false);
  }
  expectCount(n: number, timeout = DEFAULT_TIMEOUT) {
    return expect.poll(() => this.count(), { timeout, intervals: POLL, message: `${this} count` }).toBe(n);
  }
  expectText(m: TextMatch, timeout = DEFAULT_TIMEOUT) {
    const p = expect.poll(() => this.text(), { timeout, intervals: POLL, message: `${this} text` });
    return m instanceof RegExp ? p.toMatch(m) : p.toContain(m);
  }
  expectValue(v: string, timeout = DEFAULT_TIMEOUT) {
    return expect.poll(() => this.value(), { timeout, intervals: POLL, message: `${this} value` }).toBe(v);
  }
  expectChecked(v = true, timeout = DEFAULT_TIMEOUT) {
    return expect
      .poll(() => this.checked(), { timeout, intervals: POLL, message: `${this} checked` })
      .toBe(v);
  }
  expectEnabled(v = true, timeout = DEFAULT_TIMEOUT) {
    return expect
      .poll(() => this.enabled(), { timeout, intervals: POLL, message: `${this} enabled` })
      .toBe(v);
  }
}

export class Tab {
  constructor(
    readonly h: Harness,
    readonly driver: TabDriver,
  ) {}

  url(): Promise<string> {
    return retry('url', () => this.driver.url(), 5000);
  }

  /** Navigates and waits until the resulting document (page, intervention page or error) is there. */
  async goto(url: string) {
    const old = await this.mark();
    await this.driver.navigate(url);
    await this.settle(old);
  }

  /** Marks the document shown, so that `settle` can tell when another one has replaced it. */
  private async mark(): Promise<string> {
    const mark = Math.random().toString(36).slice(2);
    await this.driver.evaluate('(m) => { globalThis.__whbDocument = m; }', [mark]).catch(() => undefined);
    return mark;
  }

  /**
   * Waits until a document is loaded (best effort: blocked navigations may end on an error page),
   * and with `old`, until it is no longer the marked one: a navigation that stays in the same
   * document (a fragment, the history of a single page app) is given up to a second.
   */
  async settle(old?: string, timeout = DEFAULT_TIMEOUT) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout && !this.driver.isClosed()) {
      const doc = await this.driver
        .evaluate<{ state: string; mark?: string }>(
          '() => ({ state: document.readyState, mark: globalThis.__whbDocument })',
          [],
        )
        .catch(() => null);
      if (
        doc?.state === 'complete' &&
        (old === undefined || doc.mark !== old || Date.now() - t0 > 1000) &&
        (await this.url().catch(() => 'about:blank')) !== 'about:blank'
      )
        break;
      await sleep(50);
    }
  }

  async reload() {
    const old = await this.mark();
    await this.driver.reload();
    await this.settle(old);
  }
  async back() {
    const old = await this.mark();
    await this.driver.back();
    await this.settle(old);
  }
  close() {
    return this.driver.close();
  }
  /** Brings the tab to the front, as a user switching to it. */
  front() {
    return this.driver.activate();
  }

  /** Runs a function in the page (it is sent as source code: no closures). */
  eval<R, A extends unknown[] = []>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R> {
    return this.driver.evaluate<R>(fn.toString(), args);
  }

  get(q: Query | string): Locator {
    return new Locator(this, typeof q === 'string' ? { css: q } : q);
  }
  role(role: string, name?: TextMatch, more: Omit<Query, 'role' | 'name'> = {}): Locator {
    return this.get({ role, name, ...more });
  }
  button(name: TextMatch, more: Omit<Query, 'role' | 'name'> = {}) {
    return this.role('button', name, more);
  }
  text(text: TextMatch, more: Omit<Query, 'text'> = {}): Locator {
    return this.get({ text, ...more });
  }
  label(label: TextMatch, more: Omit<Query, 'label'> = {}): Locator {
    return this.get({ label, ...more });
  }
  placeholder(placeholder: TextMatch, more: Omit<Query, 'placeholder'> = {}): Locator {
    return this.get({ placeholder, ...more });
  }

  press(key: string) {
    return this.driver.press(key);
  }

  /** Real user activity on the page (mouse moves), so that time is counted. */
  async activity() {
    await this.driver.mouse(20 + Math.random() * 300, 20 + Math.random() * 300).catch(() => undefined);
  }

  async isIntervention(): Promise<boolean> {
    return (await this.url().catch(() => '')).startsWith(`${this.h.origin}/intervention.html#`);
  }

  /** Waits until the URL matches (substring or RegExp). */
  expectUrl(m: TextMatch, timeout = DEFAULT_TIMEOUT) {
    const p = expect.poll(() => this.url(), { timeout, intervals: POLL, message: 'tab URL' });
    return m instanceof RegExp ? p.toMatch(m) : p.toContain(m);
  }
  expectIntervention(v = true, timeout = DEFAULT_TIMEOUT) {
    return expect
      .poll(() => this.isIntervention(), { timeout, intervals: POLL, message: 'intervention page shown' })
      .toBe(v);
  }
  /** The real page of the local server is shown, with its path. */
  expectReal(hostPath: string, timeout = DEFAULT_TIMEOUT) {
    return this.get('#real').expectText(`REAL ${hostPath}`, timeout);
  }

  /** The tab id the extension knows (found through a temporary title). */
  async id(): Promise<number> {
    const marker = `whb-tab-${Math.random().toString(36).slice(2)}`;
    let original: string | null = null;
    try {
      return await retry('tab id', async () => {
        // Set on every attempt: the page may have been loaded again since.
        const title = await this.eval((m: string) => {
          const t = document.title;
          document.title = m;
          return t;
        }, marker);
        if (title !== marker) original = title;
        const id = await this.h.control.eval(
          (m: string) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.title === m)?.id ?? null),
          marker,
        );
        if (id === null) throw new Error('not yet');
        return id;
      });
    } finally {
      if (original !== null)
        await this.eval((t: string) => {
          document.title = t;
        }, original).catch(() => undefined);
    }
  }

  screenshot(path: string) {
    return this.driver.screenshot(path);
  }

  viewport(width: number, height: number) {
    return this.driver.viewport(width, height);
  }

  /** Horizontal overflow of the page in pixels (0 for a layout that fits). */
  overflowX(): Promise<number> {
    return this.eval(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  }

  /**
   * WCAG checks with axe-core, the same engine in both browsers. Returns one line per
   * violation, empty when everything passes. `only`: other tags, or the rules to run.
   */
  async axe(only: { tags?: string[]; rules?: string[] } = {}): Promise<string[]> {
    const ready = await this.eval(() => typeof (globalThis as { axe?: unknown }).axe !== 'undefined');
    if (!ready) await this.driver.inject(axeSource());
    const runOnly = only.rules
      ? { type: 'rule', values: only.rules }
      : { type: 'tag', values: only.tags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
    return this.eval(
      (o: unknown) =>
        (globalThis as unknown as { axe: any }).axe.run(document, { runOnly: o }).then((r: any) =>
          r.violations.map(
            (v: any) =>
              `${v.id} (${v.impact}): ${v.nodes
                .slice(0, 3)
                .map((n: any) => n.target.join(' '))
                .join(' | ')}`,
          ),
        ),
      runOnly,
    );
  }

  /**
   * The colour checks of axe-core in the dark theme, on the page as it is: the theme is switched in
   * place (it changes colours only) and back to the one the page had.
   */
  async axeDark(): Promise<string[]> {
    const theme = (dark: string | null, still: boolean) =>
      this.eval(
        (t: string | null, keep: boolean) => {
          const root = document.documentElement;
          const bg = () => getComputedStyle(document.body).backgroundColor;
          const before = { theme: root.getAttribute('data-theme'), bg: bg() };
          // Without transitions while the theme is switched, the colours change at once. A
          // constructed style sheet, which the pages' Content-Security-Policy allows.
          const g = globalThis as { __whbStill?: CSSStyleSheet };
          if (!g.__whbStill) {
            g.__whbStill = new CSSStyleSheet();
            g.__whbStill.replaceSync('*, *::before, *::after { transition: none !important; }');
          }
          const still = g.__whbStill;
          if (!document.adoptedStyleSheets.includes(still))
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
          if (t === null) root.removeAttribute('data-theme');
          else root.setAttribute('data-theme', t);
          const changed = bg() !== before.bg;
          if (!keep) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== still);
          return { ...before, changed };
        },
        dark,
        still,
      );
    const before = await theme('dark', true);
    try {
      if (before.theme !== 'dark' && !before.changed) return ['the dark theme did not apply'];
      return await this.axe({ rules: ['color-contrast', 'link-in-text-block'] });
    } finally {
      await theme(before.theme, false);
    }
  }
}

let axeCache: string | null = null;
function axeSource(): string {
  if (!axeCache) axeCache = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  return axeCache;
}

export interface TicketView {
  id: string;
  step: { type: string; readyAt?: number; text?: string; phrase?: string; question?: string };
}

export class Harness {
  readonly origin: string;
  readonly errors: string[] = [];
  private allowed: RegExp[] = [];
  control!: Tab;

  private constructor(
    readonly browser: BrowserName,
    public driver: BrowserDriver,
    readonly server: TestServer,
    private readonly opts: LaunchOptions,
  ) {
    this.origin = driver.origin;
  }

  /**
   * The browser of a harness whose test is over, started again as just launched (`reset`): the
   * next test gets the same as from `launch`, seconds sooner.
   */
  static async reuse(prev: Harness): Promise<Harness> {
    await prev.driver.reset();
    prev.server.reset();
    const h = new Harness(prev.browser, prev.driver, prev.server, prev.opts);
    await h.attachControl();
    return h;
  }

  static async launch(browser: BrowserName, more: Partial<LaunchOptions> = {}): Promise<Harness> {
    const server = new TestServer();
    await server.start();
    // Chromium keeps its profile in a directory of ours, so that the browser can be restarted on it.
    const opts: LaunchOptions = {
      extension: extensionDir(browser),
      port: server.port,
      ...(browser === 'chromium' ? { profile: tempProfile() } : {}),
      ...more,
    };
    const driver = browser === 'chromium' ? await launchChromium(opts) : await launchFirefox(opts);
    const h = new Harness(browser, driver, server, opts);
    await h.attachControl();
    return h;
  }

  private async attachControl() {
    this.control = new Tab(this, await this.driver.control());
    await retry('background ready', () => this.rpc('config.get'), 15_000);
  }

  url(host: string, path = '/') {
    return `http://${host}${path}`;
  }

  /** Opens a web page in a new tab, as a user typing the address. */
  async open(url: string, opts: { background?: boolean } = {}): Promise<Tab> {
    const tab = new Tab(this, await this.driver.newTab(url, opts));
    await tab.settle();
    return tab;
  }

  /** Opens an extension page (dashboard.html#/…, popup.html…) in a new tab. */
  async page(path: string): Promise<Tab> {
    const tab = await this.open(`${this.origin}/${path}`);
    await tab.get('#app *').waitFor('attached');
    return tab;
  }

  /**
   * The toolbar popup for a tab. A headless browser has no toolbar: the popup page is opened in a
   * tab and told which tab it is for (popup.html?tab=, test build only).
   */
  async popup(forTab?: Tab): Promise<Tab> {
    const id = forTab ? await forTab.id() : undefined;
    return this.page(`popup.html${id !== undefined ? `?tab=${id}` : ''}`);
  }

  /**
   * Lets the extension run in private windows (Chromium), which starts it again, and waits for its
   * background.
   */
  async allowPrivateWindows() {
    if (!this.driver.allowPrivateWindows) throw new Error(`allowPrivateWindows: not in ${this.browser}`);
    await this.driver.allowPrivateWindows();
    await expect
      .poll(
        async () => {
          await this.attachControl();
          return this.control.eval(() => chrome.extension.isAllowedIncognitoAccess());
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  }

  /** Opens a web page in a new private window, as a user typing the address there. */
  openPrivate(url: string): Promise<Tab> {
    return this.newTab(() =>
      this.control.eval((u: string) => chrome.windows.create({ incognito: true, url: u }), url),
    );
  }

  /** Runs `trigger` and returns the tab it opened. */
  async newTab(trigger: () => Promise<unknown>): Promise<Tab> {
    const tab = new Tab(this, await this.driver.waitForNewTab(trigger));
    await tab.settle();
    return tab;
  }

  /** Tabs as the extension sees them. */
  tabs(): Promise<{ id: number; url: string; active: boolean; windowId: number; title: string }[]> {
    return this.control.eval(() =>
      chrome.tabs.query({}).then((ts) =>
        ts.map((t) => ({
          id: t.id!,
          url: t.url ?? '',
          active: t.active,
          windowId: t.windowId,
          title: t.title ?? '',
        })),
      ),
    );
  }

  /** Calls a background method from an extension page, as the dashboard and the popup do. */
  async rpc<T = any>(method: string, args: unknown = {}): Promise<T> {
    const res = await this.control.eval(
      (m: string, a: unknown) =>
        chrome.runtime.sendMessage({ whb: 1, method: m, args: a }) as Promise<{
          ok: boolean;
          value?: unknown;
          error?: string;
        }>,
      method,
      args,
    );
    if (!res?.ok) throw new Error(`${method}: ${res?.error ?? 'no response'}`);
    return res.value as T;
  }

  /** Replaces part of the configuration as the dashboard would, paying any cost; returns the save result. */
  async configure(mutate: (c: any) => void): Promise<any> {
    const model = await this.rpc<{ config: any }>('config.get');
    const config = JSON.parse(JSON.stringify(model.config));
    config.settings.onboarded = true;
    mutate(config);
    const result = await this.rpc('config.save', { config });
    if (result.ticket) await this.completeTicket(result.ticket);
    return result;
  }

  /** Answers every step of a cost ticket (confirm, wait, typed text, phrase, math, reason). */
  async completeTicket(
    ticket: TicketView,
    extra: { password?: string; minutes?: number } = {},
  ): Promise<any> {
    let view: TicketView | null = ticket;
    for (let i = 0; i < 12 && view; i++) {
      const step = view.step;
      if ((step.type === 'wait' || step.type === 'intention') && step.readyAt) {
        const now = (await this.clock.now()) ?? Date.now();
        await sleep(Math.max(0, step.readyAt - now) + 300);
      }
      let answer = '';
      if (step.type === 'text') answer = step.text ?? '';
      else if (step.type === 'phrase') answer = step.phrase ?? '';
      else if (step.type === 'rulePassword') answer = extra.password ?? '';
      else if (step.type === 'math') answer = String(evalMath(step.question ?? ''));
      else if (step.type === 'reason' || step.type === 'intention') answer = 'testing';
      const r: any = await this.rpc('ticket.answer', { id: view.id, answer, minutes: extra.minutes });
      if (r.status === 'done') return r.result;
      if (r.status === 'error') throw new Error(`ticket: ${r.error}`);
      view = r.ticket;
    }
  }

  /** The extension's clock (test build): set or move it, as if time had passed. */
  readonly clock = {
    now: async (): Promise<number> => (await this.rpc<{ now: number }>('test.clock')).now,
    set: async (at: Date | number) =>
      this.rpc<{ now: number }>('test.clock', { set: typeof at === 'number' ? at : at.getTime() }),
    advance: async (ms: number) => this.rpc<{ now: number }>('test.clock', { advance: ms }),
  };

  /** Background state and test log (test build). */
  state<T = any>(): Promise<T> {
    return this.rpc<T>('test.state');
  }

  /** What the background does when an alarm fires (the next change, or the periodic one). */
  async alarm(kind: 'next' | 'periodic' = 'next') {
    await this.rpc(kind === 'next' ? 'test.reconcile' : 'test.periodic');
  }

  /**
   * Starts the extension again from its storage: a browser restart in Chromium (where a reloaded
   * command-line extension stays disabled), a reload of the add-on in Firefox (where a temporary
   * add-on does not survive a browser restart). Open tabs of the harness are no longer valid.
   */
  async restart() {
    if (this.browser === 'chromium') await this.restartBrowser();
    else await this.reloadExtension();
  }

  /** Reloads the extension (as an update would) and waits for its background. */
  async reloadExtension() {
    const before = (await this.state()).bootId;
    await this.control.eval(() => chrome.runtime.reload()).catch(() => undefined);
    // The extension's pages are closed by the reload; a new control page is opened.
    await sleep(1000);
    await expect
      .poll(
        async () => {
          await this.attachControl();
          return (await this.state()).bootId;
        },
        { timeout: 20_000 },
      )
      .not.toBe(before);
  }

  /** Terminates the background (Chrome service worker) as the browser does when it is idle. */
  stopBackground() {
    return this.driver.stopBackground();
  }

  /** Errors matching these patterns are expected by the test. */
  allowErrors(...patterns: RegExp[]) {
    this.allowed.push(...patterns);
  }

  /** Errors seen in the extension (background, pages, content scripts) during the test. */
  async collectErrors(): Promise<string[]> {
    const fromHooks = await this.rpc<string[]>('test.errors').catch(() => [] as string[]);
    return [...this.driver.errors, ...fromHooks, ...this.errors].filter(
      (e) => !this.allowed.some((p) => p.test(e)),
    );
  }

  async screenshots(dir: string) {
    const tabs = await this.driver.tabs().catch(() => []);
    let i = 0;
    for (const { tab } of tabs) {
      await tab.screenshot(join(dir, `tab-${++i}.png`)).catch(() => undefined);
    }
  }

  /** Closes the browser and restarts it on the same profile (Chromium: the extension stays installed). */
  async restartBrowser() {
    if (this.browser !== 'chromium') throw new Error('restartBrowser: Chromium only');
    if (!this.opts.profile) throw new Error('restartBrowser: launch with a profile');
    await this.driver.close();
    this.driver = await launchChromium(this.opts);
    await this.attachControl();
  }

  async close() {
    await this.driver.close().catch(() => undefined);
    this.server.close();
    if (this.opts.profile?.startsWith(tmpdir())) rmSync(this.opts.profile, { recursive: true, force: true });
  }
}

export function tempProfile() {
  return mkdtempSync(join(tmpdir(), 'whb-profile-'));
}

function evalMath(q: string): number {
  const m = q.match(/(-?\d+)\s*([+\-×x*])\s*(-?\d+)/);
  if (!m) return Number.NaN;
  const a = Number(m[1]);
  const b = Number(m[3]);
  return m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b;
}
