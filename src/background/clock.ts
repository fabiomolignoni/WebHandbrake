/**
 * Trusted clock (SCH-07, PRO-13).
 *
 * - Backward jumps of the system clock are detected by comparing the wall clock with a monotonic
 *   clock and with the highest time ever seen; the trusted time never goes backwards
 *   (conservative behaviour: restrictions last longer, budgets never refill early).
 * - Forward jumps are detected by comparing the clock with the Date header of HTTP responses the
 *   browser already receives (no additional requests, no data stored).
 */

import {
  CLOCK_AGREEMENT_MS,
  CLOCK_JUMP_TOLERANCE_MS,
  CLOCK_MIN_AGREEING_HOSTS,
  CLOCK_SKEW_SAMPLES,
  CLOCK_SKEW_THRESHOLD_MS,
} from '../engine/limits';
import type { TamperEvent } from '../engine/types';
import { api, features } from '../platform/api';
import { store } from './store';

let anchor: { trusted: number; mono: number } | null = null;
const samples: { host: string; offset: number }[] = [];
/** Test build only: shift applied by the end-to-end suite to travel in time (always 0 otherwise). */
let testOffset = 0;
const TEST_CLOCK_KEY = 'test:clock';

function monotonic(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Current trusted time in ms. Records tamper events when the clock moved backwards. */
export function now(): number {
  const wall = Date.now() + (store.state.clockOffset || 0) + testOffset;
  const mono = monotonic();
  let t = wall;
  if (anchor) {
    const expected = anchor.trusted + (mono - anchor.mono);
    if (wall < expected - CLOCK_JUMP_TOLERANCE_MS) {
      t = expected;
      report({ at: wall, kind: 'clock-backward', detail: String(Math.round((expected - wall) / 60_000)) });
    }
  }
  const last = store.state.lastWall || 0;
  if (t < last - CLOCK_JUMP_TOLERANCE_MS) {
    report({ at: wall, kind: 'clock-backward', detail: String(Math.round((last - t) / 60_000)) });
    t = last;
  }
  anchor = { trusted: t, mono };
  if (t > last) store.state.lastWall = t;
  return t;
}

/**
 * Test build only: moves the extension's clock. Unless `detect` is set, the move is not a clock
 * jump for the tamper detection (the highest time seen is reset).
 */
export async function setTestClock(offset: number, detect = false) {
  if (!__TEST__) return;
  testOffset = offset;
  if (!detect) {
    anchor = null;
    store.state.lastWall = 0;
    lastReport = 0;
  }
  await api.storage.local.set({ [TEST_CLOCK_KEY]: offset });
}

export function testClockOffset(): number {
  return testOffset;
}

/** Test build only: the clock keeps its shift when the background restarts. */
export async function restoreTestClock() {
  if (!__TEST__) return;
  const r = await api.storage.local.get(TEST_CLOCK_KEY);
  testOffset = Number(r[TEST_CLOCK_KEY]) || 0;
}

let lastReport = 0;
function report(e: TamperEvent) {
  // One event per jump, not one per call.
  if (Math.abs(e.at - lastReport) < 10 * 60_000) return;
  lastReport = e.at;
  store.addTamper(e);
  void store.saveState();
}

/** Observes Date headers of responses to detect a clock set forward (Appendix A #6). */
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
  if (samples.length > CLOCK_SKEW_SAMPLES) samples.shift();
  if (samples.length < CLOCK_MIN_AGREEING_HOSTS) return;
  const sorted = samples.map((s) => s.offset).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agreeing = sorted.filter((o) => Math.abs(o - median) < CLOCK_AGREEMENT_MS).length;
  if (agreeing < CLOCK_MIN_AGREEING_HOSTS) return;
  const current = store.state.clockOffset || 0;
  if (Math.abs(median) > CLOCK_SKEW_THRESHOLD_MS) {
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
