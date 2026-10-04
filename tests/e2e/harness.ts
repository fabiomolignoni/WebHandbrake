/** Shared Playwright harness: Chromium with the built extension and a local web server. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type BrowserContext, chromium, type Page, type Worker } from '@playwright/test';

export const EXT = join(process.cwd(), 'dist/chrome');

export interface Harness {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  port: number;
  url: (host: string, path?: string) => string;
  page: (path: string) => Promise<Page>;
  /** Calls a background RPC method from an extension page. */
  rpc: <T = unknown>(method: string, args?: unknown) => Promise<T>;
  close: () => Promise<void>;
  errors: string[];
  /** Requests received by the local web server ("host/path"). */
  requests: string[];
  /** Replaces part of the configuration (as the dashboard would) and returns the save result. */
  configure: (mutate: (c: any) => void) => Promise<any>;
  /** Answers the steps of a cost ticket (confirm, wait, typed text). */
  completeTicket: (ticket: any) => Promise<unknown>;
  /** Opens a web page in a new tab and waits for it to settle. */
  open: (url: string) => Promise<Page>;
}

export async function launch(): Promise<Harness> {
  const errors: string[] = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    requests.push(`${host}${req.url}`);
    res.end(
      `<!doctype html><title>${host}${req.url}</title><body><h1 id="real">REAL ${host}${req.url}</h1><textarea id="ta"></textarea></body>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP * 127.0.0.1:${port}`,
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  worker.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[sw] ${m.text()}`);
  });
  const extensionId = new URL(worker.url()).host;
  const base = `chrome-extension://${extensionId}`;
  let rpcPage: Page | null = null;
  const harness: Harness = {
    context,
    worker,
    extensionId,
    port,
    errors,
    requests,
    url: (host, path = '/') => `http://${host}${path}`,
    configure: async (mutate) => {
      const model = (await harness.rpc('config.get')) as { config: any };
      const config = JSON.parse(JSON.stringify(model.config));
      config.settings.onboarded = true;
      mutate(config);
      const result = (await harness.rpc('config.save', { config })) as any;
      if (result.ticket) await harness.completeTicket(result.ticket);
      return result;
    },
    completeTicket: async (ticket: any) => {
      let view = ticket;
      for (let i = 0; i < 10 && view; i++) {
        const step = view.step;
        if (step.type === 'wait')
          await new Promise((r) => setTimeout(r, Math.max(0, step.readyAt - Date.now()) + 300));
        const answer = step.type === 'text' ? step.text : step.type === 'phrase' ? step.phrase : '';
        const r = (await harness.rpc('ticket.answer', { id: view.id, answer })) as any;
        if (r.status === 'done') return r.result;
        if (r.status === 'error') throw new Error(`ticket: ${r.error}`);
        view = r.ticket;
      }
    },
    open: async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`[${url}] ${e.message}`));
      await p.goto(url).catch(() => undefined);
      await p.waitForTimeout(400);
      return p;
    },
    page: async (path) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`[page ${path}] ${e.message}`));
      p.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[page ${path}] ${m.text()}`);
      });
      await p.goto(`${base}/${path}`);
      return p;
    },
    rpc: async (method, args = {}) => {
      if (!rpcPage) {
        rpcPage = await context.newPage();
        await rpcPage.goto(`${base}/popup.html`);
      }
      return rpcPage.evaluate(
        async ([m, a]) => {
          const res = (await chrome.runtime.sendMessage({ whb: 1, method: m, args: a })) as {
            ok: boolean;
            value?: unknown;
            error?: string;
          };
          if (!res.ok) throw new Error(res.error);
          return res.value;
        },
        [method, args] as const,
      ) as Promise<never>;
    },
    close: async () => {
      await context.close();
      server.close();
    },
  };
  return harness;
}
