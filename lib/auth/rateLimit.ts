export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export type RateLimiter = {
  check(key: string): RateLimitResult;
  reset(key: string): void;
};

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  function prune(key: string, at: number): number[] {
    const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length === 0) hits.delete(key);
    else hits.set(key, recent);
    return recent;
  }

  return {
    check(key) {
      const at = now();
      const recent = prune(key, at);
      if (recent.length >= limit) {
        return { allowed: false, retryAfterMs: windowMs - (at - recent[0]) };
      }
      recent.push(at);
      hits.set(key, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

const globalForLimiter = globalThis as unknown as {
  roadwiseLoginLimiter?: RateLimiter;
};

export function loginLimiter(): RateLimiter {
  globalForLimiter.roadwiseLoginLimiter ??= createRateLimiter({
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  return globalForLimiter.roadwiseLoginLimiter;
}

export function loginLimitKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip}`;
}
