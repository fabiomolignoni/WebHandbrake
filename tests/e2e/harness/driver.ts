/**
 * What the harness needs from a browser automation backend. Two implementations:
 * - chromium.ts: Playwright over the Chrome DevTools Protocol;
 * - firefox.ts: geckodriver with a hybrid session, WebDriver classic for real input on extension
 *   pages plus WebDriver BiDi for tabs, navigation and scripts (docs/testing.md).
 */

import type { WireQuery } from './queries';

export type BrowserName = 'chromium' | 'firefox';

export interface TabDriver {
  /** URL of the document shown (as the browser reports it, also for error pages). */
  url(): Promise<string>;
  /** Starts a navigation without waiting for it (it may end on an extension page or fail). */
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  back(): Promise<void>;
  close(): Promise<void>;
  /** Makes the tab the selected tab of its window, as a user switching to it. */
  activate(): Promise<void>;
  /** Runs a function (given as source) with JSON arguments in the page and returns its JSON result. */
  evaluate<R>(fnSource: string, args: unknown[]): Promise<R>;
  /** Clicks the element of a query with real (trusted) input. */
  click(q: WireQuery): Promise<void>;
  /** Focuses the element of a query and types with real keystrokes (optionally clearing it first). */
  type(q: WireQuery, text: string, clear: boolean): Promise<void>;
  /** Chooses an option of a native <select> with real input. */
  select(q: WireQuery, value: string): Promise<void>;
  /** Presses a key ("Enter", "Escape", "Tab", "ArrowDown", a character…) on the focused element. */
  press(key: string): Promise<void>;
  /** Moves the mouse (user activity). */
  mouse(x: number, y: number): Promise<void>;
  screenshot(path: string): Promise<void>;
  /** Sets the size of the page's viewport (responsive layouts). */
  viewport(width: number, height: number): Promise<void>;
  /** Runs a script source in the page, whatever its Content-Security-Policy (axe-core). */
  inject(source: string): Promise<void>;
  isClosed(): boolean;
}

export interface LaunchOptions {
  /** Unpacked extension (dist-test/<target>). */
  extension: string;
  /** Port of the local web server every web request is sent to. */
  port: number;
  /** Profile directory, to restart the browser on the same profile. */
  profile?: string;
  /** Firefox: idle time after which the event page is suspended (ms). */
  backgroundIdleMs?: number;
}

export interface BrowserDriver {
  readonly name: BrowserName;
  /** chrome-extension://<id> or moz-extension://<uuid> */
  readonly origin: string;
  /** Errors reported by the browser itself (pages, service worker). */
  readonly errors: string[];
  /** Opens a new tab (in the background when asked). */
  newTab(url: string, opts?: { background?: boolean }): Promise<TabDriver>;
  /** Runs `trigger` and returns the tab it opened. */
  waitForNewTab(trigger: () => Promise<unknown>): Promise<TabDriver>;
  /** Every tab the driver knows, with its URL. */
  tabs(): Promise<{ tab: TabDriver; url: string }[]>;
  /** An extension page (test.html) opened at launch, from which the harness calls the background. */
  control(): Promise<TabDriver>;
  /** Terminates the background (Chrome service worker); false when the browser cannot. */
  stopBackground(): Promise<boolean>;
  close(): Promise<void>;
}
