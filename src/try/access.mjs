// The live try's access: a juror enters the code once, and a signed cookie carries the access for twelve hours. The
// pages run no script, so the cookie is what a form post and a page refresh carry. It is HttpOnly and SameSite=Lax,
// and every post is also checked for its origin. The signing key comes from SITE_SECRET and the code itself, so a new
// code ends every earlier access. Wrong codes are limited per address.

import crypto from 'node:crypto';

export const ACCESS_COOKIE = 'mousa_try';
export const ACCESS_LIMITS = Object.freeze({ ttlMs: 12 * 60 * 60 * 1000, attempts: 10, windowMs: 60 * 60 * 1000 });

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
      const at = now(), recent = (failures.get(address) || []).filter(time => at - time < limits.windowMs);
      if (recent.length >= limits.attempts) throw new AccessError(429, 'Too many wrong codes from this address. Try again in an hour.');
      if (!code || !crypto.timingSafeEqual(digest(given ?? ''), digest(code))) {
        failures.set(address, [...recent, at]);
        if (failures.size > 2000) for (const [key, list] of failures) if (at - list.at(-1) >= limits.windowMs) failures.delete(key);
        throw new AccessError(403, 'That is not the access code.');
      }
      failures.delete(address);
      const expires = String(at + limits.ttlMs);
      return `${ACCESS_COOKIE}=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(limits.ttlMs / 1000)}${secure ? '; Secure' : ''}`;
    },
  };
}
