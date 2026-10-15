import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  matchStep,
  newSecret,
  otpauthUri,
  timeStep,
  totp,
} from '../../src/background/totp';

const text = (s: string) => new TextEncoder().encode(s);
/** The secret of the RFC 6238 test vectors for HMAC-SHA-1: the ASCII digits "1234567890" twice. */
const RFC_SECRET = base32Encode(text('12345678901234567890'));

describe('partner codes', () => {
  it('base32 follows the RFC 4648 test vectors, without padding', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(text(plain))).toBe(encoded);
      expect(new TextDecoder().decode(base32Decode(encoded) ?? undefined)).toBe(plain);
    }
    // Lower case, spaces and padding are accepted when decoding; other characters are not.
    expect(base32Decode('mzxw 6ytb oi======')).toEqual(text('foobar'));
    expect(base32Decode('MZXW1')).toBeNull();
  });

  it('codes follow the RFC 6238 test vectors (HMAC-SHA-1, last six digits)', async () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, code] of vectors)
      expect(await totp(RFC_SECRET, timeStep(seconds * 1000))).toBe(code);
  });

  it('a code matches within one step of 30 seconds, spaces allowed', async () => {
    const at = 59_000; // step 1, code 287082
    expect(await matchStep(RFC_SECRET, '287082', at)).toBe(1);
    expect(await matchStep(RFC_SECRET, '287 082', at + 30_000)).toBe(1);
    expect(await matchStep(RFC_SECRET, '287082', at + 60_000)).toBeNull();
    expect(await matchStep(RFC_SECRET, '287083', at)).toBeNull();
    expect(await matchStep(RFC_SECRET, '28708', at)).toBeNull();
    expect(await matchStep(RFC_SECRET, 'abcdef', at)).toBeNull();
  });

  it('a new secret has 160 random bits, and the address is the one authenticator apps read', () => {
    const a = newSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret()).not.toBe(a);
    expect(otpauthUri('ABCD', 'Partner code', 'WebHandbrake')).toBe(
      'otpauth://totp/WebHandbrake%3APartner%20code?secret=ABCD&issuer=WebHandbrake',
    );
  });
});
