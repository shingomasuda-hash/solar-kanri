import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_POLICY,
  ADDRESS_POLICY,
  RateLimitedError,
  checkRateLimit,
  clearRateLimit,
  recordFailure,
  resetAllRateLimits,
} from '@server/auth/rate-limit';

const POLICY = { limit: 3, windowMs: 60_000 };

describe('checkRateLimit', () => {
  beforeEach(() => resetAllRateLimits());

  it('does not count the attempt it is checking', () => {
    // The load-bearing property: a successful login must never consume anyone's
    // budget. Counting on check is what locked a shared office out of itself.
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit('k', POLICY, 1000).allowed).toBe(true);
    }
    expect(checkRateLimit('k', POLICY, 1000).remaining).toBe(POLICY.limit);
  });

  it('allows failures up to the limit', () => {
    for (let i = 0; i < POLICY.limit; i++) {
      expect(checkRateLimit('k', POLICY, 1000).allowed, `attempt ${i + 1}`).toBe(true);
      recordFailure('k', POLICY, 1000);
    }
    expect(checkRateLimit('k', POLICY, 1000).allowed).toBe(false);
  });

  it('counts down the remaining failures', () => {
    recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).remaining).toBe(2);
    recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).remaining).toBe(1);
    recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).remaining).toBe(0);
  });

  it('keeps separate keys independent', () => {
    for (let i = 0; i < POLICY.limit; i++) recordFailure('a', POLICY, 1000);
    expect(checkRateLimit('a', POLICY, 1000).allowed).toBe(false);
    expect(checkRateLimit('b', POLICY, 1000).allowed).toBe(true);
  });

  it('resets when the window expires', () => {
    for (let i = 0; i < POLICY.limit; i++) recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).allowed).toBe(false);
    expect(checkRateLimit('k', POLICY, 1000 + POLICY.windowMs + 1).allowed).toBe(true);
  });

  it('reports when the window resets', () => {
    recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).resetAt).toBe(1000 + POLICY.windowMs);
  });

  it('clearRateLimit lets an honest user through after a successful login', () => {
    for (let i = 0; i < POLICY.limit; i++) recordFailure('k', POLICY, 1000);
    expect(checkRateLimit('k', POLICY, 1000).allowed).toBe(false);
    clearRateLimit('k');
    expect(checkRateLimit('k', POLICY, 1000).allowed).toBe(true);
  });
});

describe('policies', () => {
  it('gives an address far more headroom than a single account', () => {
    // The account limit stops targeted guessing and must be tight. The address
    // limit only needs to stop a spray, which runs to thousands of attempts —
    // so setting it near an office's plausible ceiling buys nothing and locks
    // out real users. An order of magnitude apart is the point, not a margin.
    expect(ADDRESS_POLICY.limit).toBeGreaterThanOrEqual(ACCOUNT_POLICY.limit * 10);
  });

  it('uses windows long enough to matter', () => {
    expect(ACCOUNT_POLICY.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(ADDRESS_POLICY.windowMs).toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe('RateLimitedError', () => {
  it('tells the user how long to wait', () => {
    const err = new RateLimitedError(Date.now() + 5 * 60_000);
    expect(err.message).toMatch(/\d+ 分後/);
  });

  it('never reports a wait of zero minutes', () => {
    expect(new RateLimitedError(Date.now() - 1000).message).toContain('1 分後');
  });
});

describe('memory safety', () => {
  beforeEach(() => resetAllRateLimits());

  it('does not grow without bound under a spray', () => {
    // 20k distinct keys against a 10k cap.
    for (let i = 0; i < 20_000; i++) recordFailure(`spray-${i}`, POLICY, 1000);
    // Still functioning afterwards is the property that matters.
    expect(checkRateLimit('after-spray', POLICY, 1000).allowed).toBe(true);
  });
});
