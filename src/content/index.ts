/**
 * Content script, injected only on the sites of the groups.
 *
 * - Reports active time: visible + focused + recent input, or media.
 * - Shows the overlay timer, intention and warnings in an isolated shadow root.
 * - Applies filters, the grace period for unsaved text and leaves full screen.
 * - Covers the page, with its media paused, when it refused to be replaced ("Leave site?" → Stay).
 * - Re-checks restored back/forward cache pages.
 * Nothing read from the page is stored.
 */

import { api } from '../platform/api';
import type { TickResponse } from '../shared/models';
import type { Envelope, TickRequest } from '../shared/rpc';
import { reportErrorsToBackground } from '../shared/test-hooks';
import { Overlay } from './overlay';

declare global {
  interface Window {
    __webHandbrake?: boolean;
  }
}

if (!window.__webHandbrake && window.top === window) {
  window.__webHandbrake = true;
  start();
}

function start() {
  if (__TEST__) reportErrorsToBackground('content');
  let lastInput = Date.now();
  let lastTyped = 0;
  let lastEditable: Element | null = null;
  let tracked = true;
  let labels: Record<string, string> | null = null;
  let state: TickResponse | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let graceUntil = 0;
  let covered = false;
  const overlay = new Overlay();
  let filterEl: HTMLStyleElement | null = null;

  const send = async (active: boolean): Promise<TickResponse | null> => {
    const env: Envelope<'cs.tick'> = {
      whb: 1,
      method: 'cs.tick',
      args: { url: location.href, active, media: mediaPlaying(), labels: !labels } satisfies TickRequest,
    };
    try {
      const res = (await api.runtime.sendMessage(env)) as { ok: boolean; value?: TickResponse };
      return res?.ok ? (res.value ?? null) : null;
    } catch {
      return null;
    }
  };

  const mediaPlaying = (): boolean => {
    if (document.pictureInPictureElement) return true;
    for (const m of document.querySelectorAll('video, audio')) {
      const el = m as HTMLMediaElement;
      if (!el.paused && !el.ended && el.readyState > 2) return true;
    }
    return false;
  };

  const isActive = (s: TickResponse['settings'] | undefined): boolean => {
    const media = mediaPlaying();
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const idleLimit = (s?.idleSeconds ?? 120) * 1000;
    const recent = !s?.idleEnabled || Date.now() - lastInput < idleLimit;
    // Focused page: counted while the user is active or watching/listening.
    if (focused && (recent || media)) return true;
    // Optional: media in background tabs, unfocused windows or Picture-in-Picture.
    if (s?.countAudio && media) return true;
    // Optional: any open tab of the group counts, active or not. Those not in view are counted by
    // the background: browsers slow the timers of hidden pages down, so their ticks would be few.
    return Boolean(s?.countInactive) && document.visibilityState === 'visible';
  };

  const apply = (res: TickResponse | null) => {
    if (!res) return;
    if (res.labels) labels = res.labels;
    state = res;
    tracked = res.tracked;
    applyFilter(res.filter?.css ?? null);
    overlay.update(res, labels ?? {});
    // Not over the grace period, which comes first.
    covered = res.cover && Date.now() >= graceUntil;
    overlay.cover(covered, labels ?? {}, openBlockPage);
    if (covered) still();
    if (!tracked && !res.leaving) stopLoop();
    else startLoop();
  };

  /** Asks for the block page again: the browser may ask once more whether to leave. */
  const openBlockPage = () => {
    void api.runtime
      .sendMessage({ whb: 1, method: 'cs.recheck', args: { url: location.href, reason: 'cover' } })
      .catch(() => undefined);
  };

  /** Under the cover nothing plays, in full screen or Picture-in-Picture. */
  const still = () => {
    for (const m of document.querySelectorAll('video, audio')) (m as HTMLMediaElement).pause();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
  };
  // Media started again by the page stops at once.
  document.addEventListener(
    'play',
    (e) => {
      if (covered) (e.target as HTMLMediaElement).pause();
    },
    true,
  );

  /**
   * The filter is on the page, or in full screen on what is shown in full screen: Chrome leaves
   * full screen out of the page's filter, Firefox does not, so it moves there to apply once.
   * It fades in only when it starts or changes: into and out of full screen it moves at once,
   * as a fade would show the page unfiltered for a moment.
   */
  const filterRule = (css: string, fade: boolean) =>
    `html { filter: ${css} !important; transition: ${fade ? 'filter .6s ease' : 'none'}; }
html:has(:fullscreen) { filter: none !important; }
:fullscreen:not(:has(:fullscreen)) { filter: ${css} !important; }
@media (prefers-reduced-motion: reduce) { html { transition: none !important; } }`;
  let filterCss: string | null = null;
  let filterFaded: ReturnType<typeof setTimeout> | undefined;

  const applyFilter = (css: string | null) => {
    if (!css || css === 'none') {
      filterEl?.remove();
      filterEl = null;
      filterCss = null;
      return;
    }
    if (!filterEl) {
      filterEl = document.createElement('style');
      filterEl.setAttribute('data-webhandbrake', 'filter');
      (document.head ?? document.documentElement).appendChild(filterEl);
    }
    if (css === filterCss) return;
    filterCss = css;
    filterEl.textContent = filterRule(css, true);
    clearTimeout(filterFaded);
    filterFaded = setTimeout(() => {
      if (filterEl && filterCss === css) filterEl.textContent = filterRule(css, false);
    }, 700);
  };

  const tick = async () => {
    const active = isActive(state?.settings);
    if (!active && state && !state.timer && !state.leaving) {
      // Nothing to show and nothing to count: stay quiet. A page to be replaced reports anyway.
      overlay.tickLocal();
      return;
    }
    apply(await send(active));
  };

  function startLoop() {
    if (timer) return;
    timer = setInterval(() => void tick(), 1000);
  }
  function stopLoop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  const refresh = () => {
    void send(isActive(state?.settings)).then(apply);
  };

  // User activity. Passive listeners, nothing recorded but the time.
  const onInput = () => {
    lastInput = Date.now();
  };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll', 'touchstart']) {
    window.addEventListener(ev, onInput, { passive: true, capture: true });
  }
  // Remember the last edited field (the content itself is never sent anywhere).
  document.addEventListener(
    'input',
    (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target instanceof HTMLInputElement && !['text', 'search', 'email', 'url', ''].includes(target.type))
        return;
      lastTyped = Date.now();
      lastEditable = target;
    },
    { capture: true, passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  // Pages restored from the back/forward cache are checked again.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) {
      void api.runtime
        .sendMessage({ whb: 1, method: 'cs.recheck', args: { url: location.href, reason: 'bfcache' } })
        .catch(() => undefined);
      refresh();
    }
  });

  const draftText = (): string => {
    const el = lastEditable;
    if (!el?.isConnected) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    const editable = (el as HTMLElement).closest?.(
      '[contenteditable=""], [contenteditable="true"]',
    ) as HTMLElement | null;
    return editable?.innerText ?? '';
  };

  api.runtime.onMessage.addListener(
    (msg: { whb?: number; cmd?: string; graceSeconds?: number }, _sender, sendResponse) => {
      if (msg?.whb !== 1) return false;
      if (msg.cmd === 'refresh') {
        startLoop();
        refresh();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.cmd === 'prepare') {
        // Leave full screen before the page is replaced.
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        const seconds = msg.graceSeconds ?? 0;
        const typing = Date.now() - lastTyped < 60_000 && draftText().trim().length > 0;
        if (seconds > 0 && typing && Date.now() > graceUntil) {
          graceUntil = Date.now() + seconds * 1000;
          overlay.grace(seconds, labels ?? {}, draftText, () => {
            void api.runtime
              .sendMessage({ whb: 1, method: 'cs.graceDone', args: { url: location.href } })
              .catch(() => undefined);
          });
          sendResponse({ grace: seconds });
        } else sendResponse({ grace: 0 });
        return false;
      }
      return false;
    },
  );

  overlay.onHide = () => refresh();
  refresh();
  startLoop();
}
