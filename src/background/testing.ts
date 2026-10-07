/**
 * Hooks for the end-to-end suite (tests/e2e), registered only in the test build (__TEST__): the
 * production bundles do not contain this module (scripts/build.mjs checks it). They let a test
 * travel in time, look at the background state and trigger what a headless browser cannot
 * (a context menu click, a keyboard shortcut, the system going idle).
 */

import { api, quiet } from '../platform/api';
import { setIdleState } from './accounting';
import { now, setTestClock, testClockOffset } from './clock';
import { contentMatches } from './contentscripts';
import { counters } from './diagnostics-state';
import { dnrStatus } from './dnr-sync';
import { onCommand, onMenuClicked } from './menus';
import { periodic } from './periodic';
import { reconcile } from './reconcile';
import { store } from './store';
import { testLog } from './test-log';

/** Changes every time the background starts: a test can tell that it was restarted. */
const bootId = crypto.randomUUID();

type Handler = (args: any, sender: chrome.runtime.MessageSender) => unknown;

/** Content scripts may report their errors too. */
export const TEST_CONTENT_METHODS = ['test.reportError'];

export function testHandlers(): Record<string, Handler> {
  return {
    /** Moves the extension's clock: `set` (epoch ms), `advance` (ms) or nothing (read). */
    'test.clock': async (a: { set?: number; advance?: number; detect?: boolean }) => {
      if (a.set !== undefined || a.advance !== undefined) {
        const offset =
          a.set !== undefined
            ? a.set - Date.now() - (store.state.clockOffset || 0)
            : testClockOffset() + a.advance!;
        await setTestClock(offset, a.detect);
        await reconcile('test-clock', { config: true });
      }
      return { now: now(), offset: testClockOffset() };
    },
    'test.state': async () => {
      await store.ready();
      return {
        bootId,
        state: store.state,
        meta: store.meta,
        later: store.later,
        intentions: store.intentions,
        counters,
        dnr: dnrStatus,
        content: contentMatches(),
        menus: testLog.menus,
        notifications: testLog.notifications,
        now: now(),
      };
    },
    'test.errors': () => testLog.errors,
    'test.reportError': (a: { message: string }, s) => {
      testLog.errors.push(`${a.message} (${s.url ?? s.tab?.url ?? '?'})`);
    },
    /** Runs what the periodic alarm runs (maintenance, daily tasks). */
    'test.periodic': () => periodic(),
    /** Runs what the alarm of the next scheduled change runs. */
    'test.reconcile': () => reconcile('test', { config: true }),
    'test.flush': () => store.flushAll(),
    'test.menu': async (a: chrome.contextMenus.OnClickData & { tabId?: number }) => {
      const tab = a.tabId !== undefined ? await quiet(api.tabs.get(a.tabId)) : undefined;
      await onMenuClicked(a, tab);
    },
    'test.command': async (a: { command: string; tabId?: number }) => {
      const tab = a.tabId !== undefined ? await quiet(api.tabs.get(a.tabId)) : undefined;
      await onCommand(a.command, tab);
    },
    'test.idle': (a: { state: 'active' | 'idle' | 'locked' }) => setIdleState(a.state),
  };
}
