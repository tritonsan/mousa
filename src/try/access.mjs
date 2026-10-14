// The live try's access: a juror enters the code once, and a signed cookie carries the access for twelve hours. The
// pages run no script, so the cookie is what a form post and a page refresh carry. It is HttpOnly and SameSite=Lax,
// and every post is also checked for its origin. The signing key comes from SITE_SECRET and the code itself, so a new
// code ends every earlier access. Wrong codes are limited per address, an IPv6 address by its /64.

import crypto from 'node:crypto';

export const ACCESS_COOKIE = 'mousa_try';
export const ACCESS_LIMITS = Object.freeze({ ttlMs: 12 * 60 * 60 * 1000, attempts: 10, windowMs: 60 * 60 * 1000, addresses: 5000 });

export class AccessError extends Error { constructor(status, message) { super(message); this.name = 'AccessError'; this.status = status; } }

const digest = value => crypto.createHash('sha256').update(String(value)).digest();

/** The cookies a request carries, by name. */
export function cookies(req) {
  const found = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) found[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return found;
}

/**
 * The address a limit counts: an IPv4 address as it is (an IPv4-mapped IPv6 one too), an IPv6 address by its /64,
 * which one subscriber usually holds whole.
 */
export function addressKey(address) {
  const text = String(address || 'unknown').trim().toLowerCase().split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text);
  if (mapped) return mapped[1];
  if (!text.includes(':') || !/^[0-9a-f:.]+$/u.test(text)) return text.slice(0, 64);
  const [head, tail = ''] = text.split('::');
  const left = head ? head.split(':') : [], right = text.includes('::') && tail ? tail.split(':') : [];
  const groups = text.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/u, '') || '0').join(':')}::/64`;
}

/** The access of one server: `code` is TRY_ACCESS_CODE, `secret` SITE_SECRET (a random one serves this process only). */
export function createTryAccess({ code, secret = '', now = Date.now, limits = ACCESS_LIMITS }) {
  const key = digest(`mousa-try-access\n${secret || crypto.randomBytes(32).toString('hex')}\n${code}`);
  const sign = expires => crypto.createHmac('sha256', key).update(`try-access:${expires}`).digest('base64url');
  const failures = new Map();
  return {
    /** Whether a request carries a valid, unexpired access cookie. */
    granted(req) {
      const value = cookies(req)[ACCESS_COOKIE] || '';
      const [expires, signature] = value.split('.');
      if (!/^\d{10,16}$/u.test(expires || '') || !signature || Number(expires) < now()) return false;
      const expected = Buffer.from(sign(expires)), given = Buffer.from(signature);
      return expected.length === given.length && crypto.timingSafeEqual(expected, given);
    },
    /** Check an entered code for an address; the Set-Cookie header value when it is right. */
    enter(given, { address = 'unknown', secure = false } = {}) {
      const at = now(), who = addressKey(address), recent = (failures.get(who) || []).filter(time => at - time < limits.windowMs);
      if (recent.length >= limits.attempts) throw new AccessError(429, 'Too many wrong codes from this address. Try again in an hour.');
      if (!code || !crypto.timingSafeEqual(digest(given ?? ''), digest(code))) {
        failures.delete(who);
        failures.set(who, [...recent, at]);
        // The oldest addresses go first, so the table stays small whoever posts.
        for (const old of failures.keys()) { if (failures.size <= limits.addresses) break; failures.delete(old); }
        throw new AccessError(403, 'That is not the access code.');
      }
      failures.delete(who);
      const expires = String(at + limits.ttlMs);
      return `${ACCESS_COOKIE}=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(limits.ttlMs / 1000)}${secure ? '; Secure' : ''}`;
    },
  };
}
