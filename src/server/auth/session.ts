import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role } from '../../../generated/prisma/enums';

/**
 * Opaque, database-backed sessions.
 *
 * A random token goes to the browser in an httpOnly cookie; only its SHA-256 is
 * stored, so a database leak cannot be replayed as a login. Server-side storage
 * (rather than a self-contained JWT) means logout and "revoke all sessions"
 * take effect immediately, which matters for an internal tool holding customer
 * data.
 */

export const SESSION_COOKIE = 'solar_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one working day

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

/** 256 bits of entropy, URL-safe. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, for anywhere a token is checked directly. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Should the session cookie carry `Secure`?
 *
 * Yes, unless this request genuinely arrived over plain HTTP — which, in
 * practice, means a developer on localhost.
 *
 * This used to read `NODE_ENV === 'production'`. That is a trap: `.env.example`
 * ships `NODE_ENV="development"`, so copying it wholesale into a hosting
 * dashboard silently drops `Secure` from the session cookie of a live HTTPS
 * site, with nothing on any screen to say so. Found on a real deployment.
 *
 * The proxy-set `x-forwarded-proto` header is the honest signal and is vendor
 * neutral. When it is absent we are not behind a proxy at all, and only a
 * development server is in that position — but the fallback still defaults to
 * secure unless NODE_ENV explicitly says development, so a missing header
 * cannot weaken a deployment either.
 */
export function shouldUseSecureCookie(forwardedProto: string | null): boolean {
  if (forwardedProto) {
    // A comma-separated chain lists the original scheme first.
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  return process.env.NODE_ENV !== 'development';
}

export function sessionCookieOptions(expires: Date, secure: boolean) {
  return {
    httpOnly: true,
    // Lax rather than Strict: Strict would drop the session on any inbound link
    // into the app, which breaks emailed project links for no real gain here.
    sameSite: 'lax' as const,
    secure,
    path: '/',
    expires,
  };
}
