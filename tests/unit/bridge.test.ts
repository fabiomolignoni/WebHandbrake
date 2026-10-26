import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';

type Bridge = typeof import('../../src/background/bridge');
type Tabs = typeof import('../../src/background/tabs');

/** The main background and, in the same browser, the background of the private windows. */
let main: FakeBrowser;
let priv: FakeBrowser;
let bridge: Bridge;
let tabs: Tabs;
let privateBridge: Bridge;
/** The browser API of the private background. */
let privateApi: any;
type Handler = Parameters<Bridge['listenToPrivateWindows']>[0];
/** How the main background answers the messages of the private windows (messages.ts in the extension). */
let handle: Handler;

const PAGE = 'chrome-extension://test/intervention.html#https://p.test/';
const privateTab = { id: 7, url: 'https://p.test/', active: true, incognito: true, title: 'P' };

/** Writes to the session storage shared by both backgrounds, as the main one does. */
const writeSession = (items: Record<string, unknown>) =>
  (globalThis as any).chrome.storage.session.set(items);

/** Lets the storage events, and the answers they carry, go through. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Loads the modules of each background with its own browser API, as two service workers would. */
async function start(opts: { relay?: boolean; openPopup?: boolean } = {}) {
  vi.resetModules();
  main = installFakeBrowser({
    chrome: true,
    tabs: [{ id: 1, url: 'https://a.test/', active: true, incognito: false, title: 'A' }],
  });
  const mainChrome = (globalThis as any).chrome;
  bridge = await import('../../src/background/bridge');
  tabs = await import('../../src/background/tabs');
  handle = () => false;
  bridge.listenToPrivateWindows((m, s, r) => handle(m, s, r));
  vi.resetModules();
  priv = installFakeBrowser({
    chrome: true,
    incognito: true,
    sharedWith: main,
    tabs: [{ ...privateTab }],
    openPopup: opts.openPopup,
  });
  privateBridge = await import('../../src/background/bridge');
  privateApi = (globalThis as any).chrome;
  if (opts.relay !== false) privateBridge.relayPrivateWindows();
  (globalThis as any).chrome = mainChrome;
  await settle();
}

beforeEach(() => start());
afterEach(() => {
  vi.useRealTimers();
});

describe("Chrome's private windows: one background decides, the private one relays", () => {
  it('runs as the relay only in the background of the private windows', () => {
    expect(privateBridge.isPrivateBackground()).toBe(true);
    expect(bridge.isPrivateBackground()).toBe(false);
  });

  it('relays the events of the private windows that the rules need', async () => {
    const seen: [string, unknown[]][] = [];
    for (const name of [
      'tabs.onUpdated',
      'tabs.onActivated',
      'windows.onFocusChanged',
      'webNavigation.onCommitted',
      'webRequest.onHeadersReceived',
      'contextMenus.onClicked',
      'commands.onCommand',
    ] as const)
      bridge.onPrivate(name, (...args) => void seen.push([name, args]));
    const native: unknown[] = [];
    bridge.listenEverywhere(main.events.onActivated, 'tabs.onActivated', (i) => void native.push(i));

    priv.events.onUpdated.fire(7, { status: 'loading' }, privateTab);
    priv.events.onUpdated.fire(7, { url: 'https://p.test/b' }, privateTab);
    priv.events.onActivated.fire({ tabId: 7, windowId: 2 });
    priv.events.onFocusChanged.fire(2);
    priv.events.onCommitted.fire({ tabId: 7, frameId: 3, url: 'https://ads.test/' });
    priv.events.onCommitted.fire({ tabId: 7, frameId: 0, url: 'https://p.test/b' });
    priv.events.onHeadersReceived.fire({
      url: 'https://p.test/b',
      tabId: 7,
      responseHeaders: [
        { name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 GMT' },
        { name: 'Set-Cookie', value: 'secret' },
      ],
    });
    priv.events.onMenuClicked.fire({ menuItemId: 'site|g1', pageUrl: 'https://p.test/b' }, privateTab);
    priv.events.onCommand.fire('block-site', privateTab);
    await settle();

    expect(seen).toEqual([
      // Only the changes of address, and the top frame.
      ['tabs.onUpdated', [7, { url: 'https://p.test/b' }, privateTab]],
      ['tabs.onActivated', [{ tabId: 7, windowId: 2 }]],
      ['windows.onFocusChanged', [2]],
      ['webNavigation.onCommitted', [{ tabId: 7, frameId: 0, url: 'https://p.test/b' }]],
      // Only the headers the clock reads.
      [
        'webRequest.onHeadersReceived',
        [
          {
            url: 'https://p.test/b',
            tabId: 7,
            responseHeaders: [{ name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 GMT' }],
          },
        ],
      ],
      ['contextMenus.onClicked', [{ menuItemId: 'site|g1', pageUrl: 'https://p.test/b' }, privateTab]],
      ['commands.onCommand', ['block-site', privateTab]],
    ]);
    // The listener of both: called once by the private window's event, once by its own.
    main.events.onActivated.fire({ tabId: 1, windowId: 1 });
    expect(native).toEqual([
      { tabId: 7, windowId: 2 },
      { tabId: 1, windowId: 1 },
    ]);
  });

  it('the "Block this site" shortcut opens the popup of a private window from its own background', async () => {
    await start({ openPopup: true });
    const seen: unknown[] = [];
    bridge.onPrivate('commands.onCommand', (...args) => void seen.push(args));
    priv.events.onCommand.fire('block-site', { ...privateTab, windowId: 3 });
    await settle();
    expect(priv.popups).toEqual([{ windowId: 3 }]);
    expect(seen).toEqual([]);
    // The popup cannot open: the main background blocks the site another way.
    priv.action.openPopup = async () => {
      throw new Error('Browser window is not active.');
    };
    priv.events.onCommand.fire('block-site', privateTab);
    // Other shortcuts are relayed as they are.
    priv.events.onCommand.fire('start-session', privateTab);
    await settle();
    expect(seen).toEqual([
      ['start-session', privateTab],
      ['block-site', privateTab],
    ]);
  });

  it('a page of a private window gets the answer of the main background, which sees its tab', async () => {
    const received: { message: unknown; sender: chrome.runtime.MessageSender }[] = [];
    handle = (message, sender, sendResponse) => {
      received.push({ message, sender });
      if ((message as { method: string }).method === 'later') {
        setTimeout(() => sendResponse({ ok: true, value: 'later' }), 5);
        return true;
      }
      sendResponse({ ok: true, value: 'now' });
      return false;
    };
    const sender = { id: 'test', url: PAGE, tab: { ...privateTab, url: PAGE } };
    const answers: unknown[] = [];
    const keep = priv.events.onMessage.fire({ whb: 1, method: 'now', args: {} }, sender, (r: unknown) =>
      answers.push(r),
    );
    priv.events.onMessage.fire({ whb: 1, method: 'later', args: {} }, sender, (r: unknown) =>
      answers.push(r),
    );
    // Not a call to the background: not relayed, not answered.
    expect(priv.events.onMessage.fire({ whb: 1, changed: ['state'] }, sender, () => {})).toEqual([false]);
    expect(keep).toEqual([true]);
    await settle();
    await new Promise((r) => setTimeout(r, 10));
    await settle();
    expect(answers).toEqual([
      { ok: true, value: 'now' },
      { ok: true, value: 'later' },
    ]);
    expect(received[0].sender).toMatchObject({ url: PAGE, tab: { id: 7, incognito: true } });
    // The tab of the message is in a private window.
    expect(await bridge.isPrivateTab(7)).toBe(true);
  });

  it('a page of a private window is told when the main background does not answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const answers: unknown[] = [];
    priv.events.onMessage.fire({ whb: 1, method: 'overview.get', args: {} }, { id: 'test' }, (r: unknown) =>
      answers.push(r),
    );
    vi.advanceTimersByTime(bridge.RELAY_MS);
    expect(answers).toEqual([{ ok: false, error: 'No response from background' }]);
  });

  it('the calls of the main background about private tabs run in the private windows', async () => {
    expect(await bridge.privateWindowsOpen()).toBe(true);
    expect(await tabs.getTab(7)).toMatchObject({ id: 7, url: 'https://p.test/', incognito: true });
    expect(await tabs.getTab(1)).toMatchObject({ id: 1, incognito: false });
    expect((await tabs.queryTabs({})).map((t) => t.id)).toEqual([1, 7]);

    priv.windows.set(2, 'minimized');
    expect(await tabs.getWindow(7, 2)).toEqual({ id: 2, state: 'minimized' });
    expect(await tabs.getWindow(1, 2)).toEqual({ id: 2, state: 'normal' });

    await tabs.updateTab(7, { url: PAGE });
    expect(priv.tabs[0].url).toBe(PAGE);
    expect(main.tabs[0].url).toBe('https://a.test/');

    priv.contentReply.fn = () => ({ grace: 5 });
    expect(await tabs.messageTab(7, { whb: 1, cmd: 'prepare' })).toEqual({ grace: 5 });
    expect(priv.messages).toEqual([{ tabId: 7, message: { whb: 1, cmd: 'prepare' } }]);
    expect(main.messages).toEqual([]);

    await tabs.onTab(7, async () => {}, 'action.setBadgeText', { tabId: 7, text: '5m' });
    await tabs.onTab(7, async () => {}, 'action.setBadgeBackgroundColor', { tabId: 7, color: '#b5562b' });
    await tabs.onTab(7, async () => {}, 'action.setTitle', { tabId: 7, title: 'WebHandbrake' });
    expect(priv.badges.get(7)).toEqual({ text: '5m', color: '#b5562b', title: 'WebHandbrake' });
    await tabs.injectScript(7, ['content.js']);

    await tabs.removeTab(7);
    expect(priv.removed).toEqual([7]);
    expect(main.removed).toEqual([]);
  });

  it('a private tab not listed yet is found in the private windows', async () => {
    priv.tabs.push({ id: 8, url: 'https://q.test/', incognito: true });
    expect(await tabs.getTab(8)).toMatchObject({ id: 8, incognito: true });
    await expect(tabs.getTab(99)).rejects.toThrow('No tab with id: 99');
  });

  it('runs only the calls it lists', async () => {
    await expect(bridge.callPrivate('tabs.create' as never, { url: 'https://p.test/' })).rejects.toThrow(
      'not relayed: tabs.create',
    );
    expect(priv.created).toEqual([]);
  });

  it('once the private windows are closed, the main background stops asking them', async () => {
    // Closing the last private window ends their background before it can list its tabs again.
    priv.tabs.splice(0);
    privateApi.tabs.query = () => new Promise(() => {});
    priv.events.onRemoved.fire(7, { windowId: 2, isWindowClosing: true });
    await settle();
    expect(await bridge.privateWindowsOpen()).toBe(false);
    expect(main.session.get('bridge:tabs')).toEqual([]);
    expect((await tabs.queryTabs({})).map((t) => t.id)).toEqual([1]);
    expect(await bridge.isPrivateTab(7)).toBe(false);
  });

  it('closed with their background before it could say so: one call waits, the next ones do not', async () => {
    await start({ relay: false });
    await writeSession({ 'bridge:tabs': [7] });
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const query = tabs.queryTabs({});
    await vi.advanceTimersByTimeAsync(bridge.PRIVATE_CALL_MS);
    expect((await query).map((t) => t.id)).toEqual([1]);
    expect(await bridge.privateWindowsOpen()).toBe(false);
    expect(main.session.get('bridge:tabs')).toEqual([]);
  });

  it('a list of the private tabs changed by the main background is written again while they are open', async () => {
    await writeSession({ 'bridge:tabs': [] });
    await settle();
    expect(main.session.get('bridge:tabs')).toEqual([7]);
    expect(await bridge.privateWindowsOpen()).toBe(true);
    // A new private tab.
    priv.tabs.push({ id: 9, url: 'https://r.test/', incognito: true });
    priv.events.onCreated.fire({ id: 9 });
    await settle();
    expect(main.session.get('bridge:tabs')).toEqual([7, 9]);
  });

  it('the context menu and the broadcasts reach the private windows', async () => {
    const items = [{ id: 'site', title: 'Block this site', contexts: ['page'] }] as never;
    await bridge.sharePrivateMenus(items);
    await settle();
    expect(priv.menus).toEqual(items);
    expect(main.menus).toEqual([]);

    bridge.broadcastToPrivate({ whb: 1, changed: ['state'] });
    await settle();
    expect(priv.broadcasts).toEqual([{ whb: 1, changed: ['state'] }]);
    expect(main.broadcasts).toEqual([]);
  });

  it('a private background that starts creates the menus already shared', async () => {
    const items = [{ id: 'page', title: 'Block this page', contexts: ['page'] }] as never;
    await bridge.sharePrivateMenus(items);
    await start();
    await bridge.sharePrivateMenus(items);
    await settle();
    expect(priv.menus).toEqual(items);
  });

  it('the private background writes nothing but the channel: one background keeps the data', async () => {
    handle = (_m, _s, sendResponse) => {
      sendResponse({ ok: true });
      return false;
    };
    priv.events.onMessage.fire(
      { whb: 1, method: 'cs.tick', args: {} },
      { id: 'test', tab: privateTab },
      () => {},
    );
    priv.events.onActivated.fire({ tabId: 7, windowId: 2 });
    await tabs.getTab(7);
    await settle();
    expect([...main.local.keys()]).toEqual([]);
    expect([...main.session.keys()].every((k) => k.startsWith('bridge:'))).toBe(true);
  });
});
