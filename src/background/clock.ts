/**
 * Trusted clock (SCH-07, PRO-13).
 *
 * - Backward jumps of the system clock are detected by comparing the wall clock with a monotonic
 *   clock and with the highest time ever seen; the trusted time never goes backwards
 *   (conservative behaviour: restrictions last longer, budgets never refill early).
 * - Forward jumps are detected by comparing the clock with the Date header of HTTP responses the
 *   browser already receives (no additional requests, no data stored).
 */

import type { TamperEvent } from '../engine/types';
import { api, features } from '../platform/api';
import { store } from './store';

const JUMP_TOLERANCE = 60_000;
const SKEW_THRESHOLD = 10 * 60_000;
const SKEW_SAMPLES = 9;

let anchor: { trusted: number; mono: number } | null = null;
const samples: { host: string; offset: number }[] = [];

function monotonic(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Current trusted time in ms. Records tamper events when the clock moved backwards. */
export function now(): number {
  const wall = Date.now() + (store.state.clockOffset || 0);
  const mono = monotonic();
  let t = wall;
  if (anchor) {
    const expected = anchor.trusted + (mono - anchor.mono);
    if (wall < expected - JUMP_TOLERANCE) {
      t = expected;
      report({ at: wall, kind: 'clock-backward', detail: String(Math.round((expected - wall) / 60_000)) });
    }
  }
  const last = store.state.lastWall || 0;
  if (t < last - JUMP_TOLERANCE) {
    report({ at: wall, kind: 'clock-backward', detail: String(Math.round((last - t) / 60_000)) });
    t = last;
  }
  anchor = { trusted: t, mono };
  if (t > last) store.state.lastWall = t;
  return t;
}

let lastReport = 0;
function report(e: TamperEvent) {
  // One event per jump, not one per call.
  if (Math.abs(e.at - lastReport) < 10 * 60_000) return;
  lastReport = e.at;
  store.addTamper(e);
  void store.saveState();
}

/** Observes Date headers of responses to detect a clock set forward (Appendix B #6). */
export function initClockObserver() {
  if (!features.webRequest) return;
  try {
    api.webRequest.onHeadersReceived.addListener(
      (details) => {
        if (!store.config.settings.clock.useDateHeaders) return;
        if ((details as { fromCache?: boolean }).fromCache) return;
        const headers = details.responseHeaders ?? [];
        let date: string | undefined;
        let age = 0;
        for (const h of headers) {
          const name = h.name.toLowerCase();
          if (name === 'date') date = h.value;
          else if (name === 'age') age = Number(h.value) || 0;
        }
        if (!date || age > 0) return;
        const server = Date.parse(date);
        if (!Number.isFinite(server)) return;
        let host = '';
        try {
          host = new URL(details.url).hostname;
        } catch {
          return;
        }
        addSample(host, server - Date.now());
      },
      { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
      ['responseHeaders'],
    );
  } catch {
    // webRequest unavailable: Date header checks are optional.
  }
}

export function addSample(host: string, offset: number) {
  const i = samples.findIndex((s) => s.host === host);
  if (i !== -1) samples.splice(i, 1);
  samples.push({ host, offset });
  if (samples.length > SKEW_SAMPLES) samples.shift();
  if (samples.length < 3) return;
  const sorted = samples.map((s) => s.offset).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agreeing = sorted.filter((o) => Math.abs(o - median) < 120_000).length;
  if (agreeing < 3) return;
  const current = store.state.clockOffset || 0;
  if (Math.abs(median) > SKEW_THRESHOLD) {
    if (Math.abs(median - current) > 60_000) {
      store.state.clockOffset = Math.round(median);
      // The highest time seen was measured with the wrong clock.
      store.state.lastWall = Date.now() + median;
      anchor = null;
      store.addTamper({ at: Date.now(), kind: 'clock-skew', detail: String(Math.round(median / 60_000)) });
      void store.saveState();
    }
  } else if (current !== 0) {
    store.state.clockOffset = 0;
    void store.saveState();
  }
}
