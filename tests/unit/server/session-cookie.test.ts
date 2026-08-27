import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieOptions, shouldUseSecureCookie } from '@server/auth/session';

/**
 * The session cookie must carry `Secure` on any HTTPS deployment.
 *
 * This is pinned because the previous rule — `NODE_ENV === 'production'` — was
 * a trap that a real deployment fell into: `.env.example` ships
 * `NODE_ENV="development"`, and copying it wholesale into a hosting dashboard
 * quietly stripped `Secure` from the session cookie of a live HTTPS site. There
 * was nothing on any screen to show it, which is what makes this class of bug
 * worth a test rather than a comment.
 */
describe('session cookie security', () => {
  // stubEnv rather than assignment: @types/node declares NODE_ENV read-only.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is secure behind an HTTPS proxy, whatever NODE_ENV says', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(shouldUseSecureCookie('https')).toBe(true);
  });

  it('reads the original scheme from a forwarded chain', () => {
    expect(shouldUseSecureCookie('https, http')).toBe(true);
    expect(shouldUseSecureCookie('HTTPS')).toBe(true);
    expect(shouldUseSecureCookie('http, https')).toBe(false);
  });

  it('is not secure for a plain HTTP request', () => {
    // Only a local development server is in this position.
    expect(shouldUseSecureCookie('http')).toBe(false);
  });

  it('defaults to secure when no proxy header is present', () => {
    // A missing header must never be a way to weaken a deployment.
    vi.stubEnv('NODE_ENV', 'production');
    expect(shouldUseSecureCookie(null)).toBe(true);
    vi.stubEnv('NODE_ENV', 'test');
    expect(shouldUseSecureCookie(null)).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(shouldUseSecureCookie(null)).toBe(false);
  });

  it('is always httpOnly and lax, and scoped to the whole site', () => {
    const options = sessionCookieOptions(new Date('2026-01-01T00:00:00Z'), true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(true);
  });
});
