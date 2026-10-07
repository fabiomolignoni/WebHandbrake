/**
 * Test build only (__TEST__): error capture and clock shift for the end-to-end suite. Every call
 * site is guarded by `if (__TEST__)`, so none of this is shipped.
 */

import { api } from '../platform/api';

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Records uncaught errors, unhandled rejections and console.error calls of a context. */
export function captureErrors(where: string, report: (message: string) => void) {
  const push = (m: string) => report(`[${where}] ${m}`);
  globalThis.addEventListener?.('error', (e: Event) => {
    const ev = e as ErrorEvent;
    push(ev.error ? text(ev.error) : (ev.message ?? 'error'));
  });
  globalThis.addEventListener?.('unhandledrejection', (e: Event) => {
    push(`unhandled rejection: ${text((e as PromiseRejectionEvent).reason)}`);
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push(args.map(text).join(' '));
    original(...args);
  };
}

/** Errors of a page or content script are kept by the background, where the suite reads them. */
export function reportErrorsToBackground(where: string) {
  captureErrors(where, (message) => {
    void Promise.resolve(
      api.runtime.sendMessage({ whb: 1, method: 'test.reportError', args: { message } }),
    ).catch(() => undefined);
  });
}

/** Moves Date by the background's test clock offset, so that countdowns agree with it. */
export async function followTestClock() {
  const r = (await api.runtime.sendMessage({ whb: 1, method: 'test.clock', args: {} })) as
    | { ok: boolean; value?: { offset: number } }
    | undefined;
  const offset = r?.ok ? (r.value?.offset ?? 0) : 0;
  if (!offset) return;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(realNow() + offset);
      else super(...(args as [number]));
    }
    static override now() {
      return realNow() + offset;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
