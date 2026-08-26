/**
 * Login rate limiting (brief rule 33).
 *
 * Fixed-window counters over **failed attempts only**.
 *
 * That distinction matters. An earlier version counted every attempt, which
 * meant a shared office IP burned its budget on successful logins and would
 * lock itself out after 30 people signed in — a self-inflicted outage strictly
 * worse than the attack it prevents. The limiter exists to bound guessing, and
 * a successful login is not a guess. So: check before, record only on failure.
 *
 * Two independent buckets, because they defend different things:
 *  - **per account** — stops an attacker grinding one known address,
 *  - **per source address** — stops a spray across many addresses.
 *
 * **Limitation, stated plainly:** the store is in process memory, so each
 * application instance counts separately and N instances allow N times the
 * limit. For a small internal tool on one or two instances that is an
 * acceptable trade against adding Redis. The interface is deliberately narrow
 * so swapping the store is a small change. Tracked as OI-106.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Failed attempts left in the current window. */
  readonly remaining: number;
  /** When the window resets, epoch milliseconds. */
  readonly resetAt: number;
}

interface Bucket {
  failures: number;
  resetAt: number;
}

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

/** 10 failed attempts per account per 15 minutes. */
export const ACCOUNT_POLICY: RateLimitPolicy = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * 200 failed attempts per source address per 15 minutes.
 *
 * Far higher than the account limit, deliberately. The two limits stop
 * different things and a single number cannot do both:
 *
 *  - The **account** limit (10) is what stops targeted guessing. It is the one
 *    that has to be tight, and it can be, because one person mistyping their
 *    own password ten times in a quarter of an hour has a different problem.
 *  - The **address** limit only has to stop a spray across many accounts, and a
 *    real spray is thousands of attempts per minute. Set it near an office's
 *    plausible ceiling and you get false positives — a whole floor locked out
 *    because Monday morning produced a run of stale-password failures — while
 *    an actual attacker is stopped by the account limit anyway.
 *
 * So this is set where it cannot plausibly be reached by legitimate use, and
 * still catches automated spraying by orders of magnitude.
 */
export const ADDRESS_POLICY: RateLimitPolicy = { limit: 200, windowMs: 15 * 60 * 1000 };

/**
 * Held on `globalThis` rather than in module scope.
 *
 * Next.js can include a module in more than one server bundle, and re-evaluates
 * modules on hot reload in development. Either would give each copy its own
 * counter, so a limit of 10 would silently become 10 per bundle. This is the
 * same pattern the Prisma client uses, for the same reason — and it was caught
 * by a browser test, not by the unit tests, which import the module once.
 */
const globalForRateLimit = globalThis as unknown as {
  __solarKanriRateLimitBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> = (globalForRateLimit.__solarKanriRateLimitBuckets ??= new Map<
  string,
  Bucket
>());

/** Bounded so a spray across many keys cannot grow this map without limit. */
const MAX_BUCKETS = 10_000;

/**
 * Is this key currently allowed to attempt a login? Does not count the attempt.
 */
export function checkRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, remaining: policy.limit, resetAt: now + policy.windowMs };
  }
  return {
    allowed: bucket.failures < policy.limit,
    remaining: Math.max(0, policy.limit - bucket.failures),
    resetAt: bucket.resetAt,
  };
}

/**
 * Record a failed attempt. Call this only after authentication has actually
 * failed — a successful login must never consume anyone's budget.
 */
export function recordFailure(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitResult {
  pruneExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + policy.windowMs;
    buckets.set(key, { failures: 1, resetAt });
    return { allowed: policy.limit > 1, remaining: policy.limit - 1, resetAt };
  }

  bucket.failures += 1;
  return {
    allowed: bucket.failures < policy.limit,
    remaining: Math.max(0, policy.limit - bucket.failures),
    resetAt: bucket.resetAt,
  };
}

/**
 * Clear a key's failures. Called after a successful login, so someone who
 * mistyped twice and then got it right starts clean.
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

export function resetAllRateLimits(): void {
  buckets.clear();
}

function pruneExpired(now: number): void {
  // Cheap path: only sweep occasionally while the map is small.
  if (buckets.size < MAX_BUCKETS && buckets.size % 64 !== 0) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  // If everything is still live and we are over the cap, drop the entries
  // closest to expiry. Under a spray this loses some counters, which fails open
  // for a few requests rather than exhausting memory.
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of sorted.slice(0, buckets.size - MAX_BUCKETS)) buckets.delete(key);
  }
}

export class RateLimitedError extends Error {
  readonly resetAt: number;

  constructor(resetAt: number) {
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
    super(
      `ログイン試行が多すぎます。${minutes} 分後にもう一度お試しください。 / ` +
        'Too many login attempts. Please try again later.',
    );
    this.name = 'RateLimitedError';
    this.resetAt = resetAt;
  }
}
