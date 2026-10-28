import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/engine/defaults';
import { installFakeBrowser } from './fake-browser';

/** A page's root element and the system's colours, as a page sees them. */
function installPage(dark: boolean) {
  const attributes = new Map<string, string>();
  const listeners: (() => void)[] = [];
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (k: string, v: string) => attributes.set(k, v),
      removeAttribute: (k: string) => attributes.delete(k),
    },
  });
  vi.stubGlobal('matchMedia', () => media);
  return {
    theme: () => attributes.get('data-theme'),
    contrast: () => attributes.get('data-contrast'),
    setSystem(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
  };
}

describe('the appearance of the pages', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeBrowser();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows the system colours with the settings as they are now, not as the page opened', async () => {
    const page = installPage(true);
    const { applyAppearance, followSystemColours } = await import('../../src/ui/hooks');
    const s = defaultSettings();
    applyAppearance(s);
    followSystemColours();
    expect(page.theme()).toBe('dark');
    page.setSystem(false);
    expect(page.theme()).toBe('light');
    // Chosen in Settings while the page is open: a dark theme, with high contrast.
    applyAppearance({ ...s, theme: 'dark', highContrast: true });
    page.setSystem(true);
    page.setSystem(false);
    expect(page.theme()).toBe('dark');
    expect(page.contrast()).toBe('high');
  });
});
