/**
 * Minimal W3C WebDriver client for geckodriver: one "hybrid" session that speaks WebDriver classic
 * over HTTP and WebDriver BiDi over a WebSocket (the `webSocketUrl` capability), like WebdriverIO.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export type ElementRef = { [ELEMENT_KEY]: string };

export function elementId(ref: unknown): string | null {
  if (ref && typeof ref === 'object' && ELEMENT_KEY in ref) return (ref as ElementRef)[ELEMENT_KEY];
  return null;
}

export class WebDriverError extends Error {
  constructor(
    readonly error: string,
    message: string,
  ) {
    super(`${error}: ${message}`);
  }
}

type Listener = (params: any) => void;

export class WebDriverSession {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<Listener>>();
  private closed = false;

  private constructor(
    private readonly proc: ChildProcess,
    private readonly base: string,
    readonly id: string,
    private readonly ws: WebSocket,
    readonly capabilities: Record<string, any>,
  ) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (typeof m.id === 'number' && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.type === 'error') p.reject(new WebDriverError(m.error, m.message));
        else p.resolve(m.result);
      } else if (m.method) {
        for (const l of this.listeners.get(m.method) ?? []) l(m.params);
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('BiDi connection closed'));
      this.pending.clear();
    };
  }

  static async start(geckodriver: string, capabilities: Record<string, unknown>): Promise<WebDriverSession> {
    const port = await freePort();
    const wsPort = await freePort();
    const proc = spawn(
      geckodriver,
      ['--port', String(port), '--websocket-port', String(wsPort), '--allow-system-access'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    const base = `http://127.0.0.1:${port}`;
    let session: { sessionId: string; capabilities: Record<string, any> } | null = null;
    for (let i = 0; i < 100 && !session; i++) {
      try {
        const r = await fetch(`${base}/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capabilities: { alwaysMatch: capabilities } }),
        });
        const j = (await r.json()) as { value: any };
        if (j.value?.error) throw new WebDriverError(j.value.error, j.value.message);
        session = j.value;
      } catch (e) {
        if (e instanceof WebDriverError) {
          proc.kill();
          throw e;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!session) {
      proc.kill();
      throw new Error(`geckodriver did not start: ${stderr}`);
    }
    const ws = new WebSocket(session.capabilities.webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('cannot open the BiDi WebSocket'));
    });
    return new WebDriverSession(proc, base, session.sessionId, ws, session.capabilities);
  }

  /** WebDriver classic command. */
  async classic<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/session/${this.id}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const j = (await r.json()) as { value: any };
    if (j.value && typeof j.value === 'object' && 'error' in j.value)
      throw new WebDriverError(j.value.error, j.value.message);
    return j.value as T;
  }

  /** WebDriver BiDi command. */
  bidi<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('session closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.classic('DELETE', '');
    } catch {
      // the browser may already be gone
    }
    this.ws.close();
    this.proc.kill();
  }
}

/** WebDriver key codes for named keys (W3C WebDriver §17.4.2). */
export const KEYS: Record<string, string> = {
  Backspace: '',
  Tab: '',
  Enter: '',
  Shift: '',
  Control: '',
  Alt: '',
  Escape: '',
  Space: ' ',
  PageUp: '',
  PageDown: '',
  End: '',
  Home: '',
  ArrowLeft: '',
  ArrowUp: '',
  ArrowRight: '',
  ArrowDown: '',
  Delete: '',
  Meta: '',
};
