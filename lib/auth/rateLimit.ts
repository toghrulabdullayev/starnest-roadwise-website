/**
 * Best-effort, per-instance, in-memory rate limiter (roadwise-web §5).
 * On Vercel each function instance has its own memory, so the effective
 * limit can be higher than configured. Good enough to slow down guessing.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt. allowed=false once the limit inside the window is reached. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfterS: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterS: Math.ceil((recent[0] + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(now);
    return { allowed: true, retryAfterS: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

/** Login: 5 tries per 10 minutes per email+IP. */
export const loginLimiter = new RateLimiter(5, 10 * 60 * 1000);
/** Sign-up: 10 per hour per IP. */
export const signupLimiter = new RateLimiter(10, 60 * 60 * 1000);
