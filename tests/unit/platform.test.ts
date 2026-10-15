import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBrowser } from './fake-browser';

describe('the platform adapter', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });

  it('the address of the intervention page carries the blocked one, and gives it back', async () => {
    const api = await import('../../src/platform/api');
    const url = api.interventionUrl('https://a.test/x?y=1#z');
    expect(url).toBe('chrome-extension://test/intervention.html#https://a.test/x?y=1#z');
    expect(api.blockedUrlFrom(url)).toBe('https://a.test/x?y=1#z');
    expect(api.blockedUrlFrom('chrome-extension://test/intervention.html')).toBeNull();
    expect(api.blockedUrlFrom('https://a.test/#x')).toBeNull();
    expect(api.blockedUrlFrom(undefined)).toBeNull();
  });

  it('Chrome is not Firefox; optional APIs are detected', async () => {
    const api = await import('../../src/platform/api');
    expect(api.isFirefox).toBe(false);
    expect(api.features).toMatchObject({ contextMenus: true, notifications: true, sessionStorage: true });
    expect(['chrome', 'edge', 'other']).toContain(api.browserName());
  });

  it('session storage falls back to memory where the browser has none', async () => {
    delete (globalThis as any).chrome.storage.session;
    const { sessionStore } = await import('../../src/platform/api');
    await sessionStore.set('k', { a: 1 });
    expect(await sessionStore.get('k')).toEqual({ a: 1 });
    await sessionStore.remove('k');
    expect(await sessionStore.get('k')).toBeUndefined();
  });

  it('errors of a page or a tab that does not listen are quiet', async () => {
    const { quiet } = await import('../../src/platform/api');
    expect(await quiet(Promise.reject(new Error('no receiving end')))).toBeUndefined();
    expect(await quiet(Promise.resolve(3))).toBe(3);
    expect(await quiet(undefined)).toBeUndefined();
  });
});
