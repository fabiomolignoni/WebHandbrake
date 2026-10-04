/** URL parsing and normalisation shared by matching, DNR compilation and the UI. */

export interface ParsedUrl {
  /** Original URL after unwrapping view-source:/reader mode. */
  href: string;
  /** Lower case scheme without the colon: http, https, file, about, chrome… */
  scheme: string;
  /** http or https */
  web: boolean;
  /** Lower case, punycode, without trailing dot. Empty for file: and about: URLs. */
  host: string;
  /** Lower case path. For about:/chrome: URLs the part after the scheme. */
  path: string;
  /** Query parameters (keys lower case, values as decoded). */
  query: [string, string][];
  /** Fragment without '#'. */
  fragment: string;
}

const READER_PREFIX = 'about:reader?url=';

/** Unwraps view-source: and Firefox reader mode URLs so the underlying page is evaluated (TIM-06). */
export function unwrapUrl(raw: string): string {
  let url = raw.trim();
  for (let i = 0; i < 3; i++) {
    if (url.toLowerCase().startsWith('view-source:')) {
      url = url.slice('view-source:'.length);
      continue;
    }
    if (url.toLowerCase().startsWith(READER_PREFIX)) {
      try {
        url = decodeURIComponent(url.slice(READER_PREFIX.length));
      } catch {
        url = url.slice(READER_PREFIX.length);
      }
      continue;
    }
    break;
  }
  return url;
}

export function parseUrl(raw: string): ParsedUrl | null {
  const href = unwrapUrl(raw);
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  const web = scheme === 'http' || scheme === 'https';
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  let path: string;
  if (web || scheme === 'file' || u.host) {
    path = u.pathname.toLowerCase() || '/';
  } else {
    // about:config, chrome://extensions (no host for about:), moz-extension…
    path = (u.pathname || '').toLowerCase();
  }
  const query: [string, string][] = [];
  u.searchParams.forEach((v, k) => {
    query.push([k.toLowerCase(), v]);
  });
  return { href, scheme, web, host, path, query, fragment: u.hash.replace(/^#/, '') };
}

/** Removes the fragment from a URL (fragments never reach the network). */
export function stripFragment(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

/** URL used as identity for page-scoped grants and "Save for later" de-duplication. */
export function pageKey(url: string): string {
  const p = parseUrl(url);
  if (!p) return stripFragment(url);
  const q = p.query.map(([k, v]) => `${k}=${v}`).join('&');
  const path = p.path.length > 1 ? p.path.replace(/\/+$/, '') : p.path;
  return `${p.scheme}://${stripWww(p.host)}${path}${q ? `?${q}` : ''}`;
}

export function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** Converts a (possibly internationalised) host name to lower case ASCII/punycode. */
export function toAsciiHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  if (/^[a-z0-9.*_-]+$/.test(h)) return h;
  if (h.includes('*')) {
    // Convert every non-wildcard label separately.
    const labels = h.split('.').map((label) => (label === '*' ? '*' : toAsciiHost(label)));
    return labels.some((l) => l === null) ? null : labels.join('.');
  }
  try {
    return new URL(`http://${h}/`).hostname;
  } catch {
    return null;
  }
}

/** Whether a URL belongs to the extension itself (never blocked, ENF-09). */
export function isExtensionUrl(url: string): boolean {
  return /^(chrome-extension|moz-extension|safari-web-extension|extension):/i.test(url);
}

/** Display form of a URL host: without www. and decoded from punycode when possible. */
export function displayHost(url: string): string {
  const p = parseUrl(url);
  if (!p) return url;
  if (!p.web) return p.href;
  return stripWww(p.host);
}
