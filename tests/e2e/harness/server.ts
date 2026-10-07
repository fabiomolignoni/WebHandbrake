/**
 * Local web server standing in for the whole web: Chromium resolves every host to it, Firefox
 * sends every request to it as a proxy. Every request is logged, so a test can prove that a
 * blocked site was never contacted (ENF-01) and that the extension makes no requests (PRIV-01).
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoggedRequest {
  host: string;
  path: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  at: number;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

type Route = { host: string | RegExp; path?: string | RegExp; reply: (req: LoggedRequest) => Reply };

/** The default page: its host and path, a text area and a few links. */
export function defaultPage(host: string, path: string, extra = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${host}${path}</title></head>
<body><h1 id="real">REAL ${host}${path}</h1>
<textarea id="ta" aria-label="Comment"></textarea>
<p><a id="next" href="/next">next</a> <a id="other" href="http://other.test/">other</a></p>
${extra}</body></html>`;
}

export class TestServer {
  readonly requests: LoggedRequest[] = [];
  private routes: Route[] = [];
  private server: http.Server;
  port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      // Requests through a proxy carry the absolute URL.
      const path = (req.url ?? '/').replace(/^https?:\/\/[^/]+/, '') || '/';
      const logged: LoggedRequest = {
        host,
        path,
        method: req.method ?? 'GET',
        headers: req.headers,
        at: Date.now(),
      };
      this.requests.push(logged);
      const route = this.routes.find(
        (r) =>
          (typeof r.host === 'string' ? r.host === host : r.host.test(host)) &&
          (r.path === undefined ||
            (typeof r.path === 'string' ? path.startsWith(r.path) : r.path.test(path))),
      );
      if (path === '/favicon.ico' && !route) {
        // An empty icon: a 404 would be logged as an error by the page that is navigating away.
        res.writeHead(200, { 'content-type': 'image/x-icon', 'content-length': '0' });
        res.end();
        return;
      }
      const reply = route?.reply(logged) ?? { body: defaultPage(host, path) };
      res.writeHead(reply.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...reply.headers });
      res.end(reply.body ?? '');
    });
  }

  async start() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Serves a custom reply for a host (and optionally a path prefix or pattern). */
  route(host: string | RegExp, reply: Reply | ((req: LoggedRequest) => Reply), path?: string | RegExp) {
    this.routes.unshift({ host, path, reply: typeof reply === 'function' ? reply : () => reply });
  }

  /** Requests received for a host (and path prefix), favicons excluded. */
  hits(host: string, path = ''): LoggedRequest[] {
    return this.requests.filter(
      (r) => r.host === host && r.path.startsWith(path) && r.path !== '/favicon.ico',
    );
  }

  close() {
    this.server.closeAllConnections?.();
    this.server.close();
  }
}
