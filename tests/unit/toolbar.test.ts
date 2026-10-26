import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeBrowser, installFakeBrowser } from './fake-browser';

let fake: FakeBrowser;

describe('the toolbar button', () => {
  beforeEach(() => {
    vi.resetModules();
    fake = installFakeBrowser({ tabs: [{ id: 1, url: 'https://a.test/', active: true }] });
  });

  it('opens the popup on a computer', async () => {
    const { registerToolbar } = await import('../../src/background/toolbar');
    registerToolbar(false);
    expect(fake.popup.value).toBe('popup.html');
    expect(fake.action.onClicked.listeners).toEqual([]);
  });

  it('on Android, opens the dashboard without the popup: its tab when one is open', async () => {
    const { registerToolbar } = await import('../../src/background/toolbar');
    registerToolbar(true);
    await Promise.resolve();
    expect(fake.popup.value).toBe('');
    await Promise.all(fake.action.onClicked.fire());
    await vi.waitFor(() =>
      expect(fake.created.map((t) => t.url)).toEqual(['chrome-extension://test/dashboard.html']),
    );
    // Opened since on another page of the dashboard, behind the site.
    fake.tabs.push({ id: 2, url: 'chrome-extension://test/dashboard.html#/insights', active: false });
    fake.action.onClicked.fire();
    await vi.waitFor(() => expect(fake.tabs.find((t) => t.id === 2)?.active).toBe(true));
    expect(fake.created).toHaveLength(1);
  });
});
