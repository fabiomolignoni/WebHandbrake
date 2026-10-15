/**
 * Time-based one-time codes: RFC 6238 with HMAC-SHA-1, 6 digits and 30-second steps,
 * the defaults that every authenticator app reads from an otpauth:// address. The partner's app and
 * WebHandbrake share a secret; nothing is sent anywhere.
 */

/** Seconds a code lasts. */
export const TOTP_STEP_SECONDS = 30;
/** Digits of a code. */
export const TOTP_DIGITS = 6;
/** Steps accepted before and after the current one, for clocks that differ by up to 30 seconds. */
export const TOTP_WINDOW = 1;
/** Bytes of a new secret: 160 bits, the size RFC 4226 recommends for HMAC-SHA-1. */
const SECRET_BYTES = 20;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648) without padding, as authenticator apps take secrets. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes base32, ignoring case, spaces and padding; null when a character is not base32. */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v === -1) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new random secret, in base32. */
export function newSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

/** The time step of a moment (ms since the epoch). */
export function timeStep(at: number): number {
  return Math.floor(at / 1000 / TOTP_STEP_SECONDS);
}

/** The code of a time step (RFC 4226 dynamic truncation). */
export async function totp(secret: string, step: number): Promise<string> {
  const key = base32Decode(secret);
  if (!key?.length) throw new Error('totp: invalid secret');
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = n & 255;
    n = Math.floor(n / 256);
  }
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, counter));
  const offset = mac[mac.length - 1] & 15;
  const binary =
    ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * The time step whose code is `code` at `at`, within TOTP_WINDOW steps, or null. The answer may
 * contain spaces, as apps show codes in two groups of three digits.
 */
export async function matchStep(secret: string, code: string, at: number): Promise<number | null> {
  const typed = code.replace(/\s/g, '');
  if (!/^\d+$/.test(typed) || typed.length !== TOTP_DIGITS) return null;
  const now = timeStep(at);
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++)
    if ((await totp(secret, now + d)) === typed) return now + d;
  return null;
}

/** The otpauth:// address that authenticator apps read from a QR code. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
