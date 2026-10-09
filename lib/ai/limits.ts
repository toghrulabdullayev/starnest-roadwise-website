import { RateLimiter } from "@/lib/auth/rateLimit";

const globalForLimits = globalThis as unknown as { roadwiseAiLimiters?: Record<string, RateLimiter> };

/** Per-user, in-memory (best effort per instance), one limiter per feature name. */
export function aiLimiter(name: string, limit: number, windowMs: number): RateLimiter {
  const all = (globalForLimits.roadwiseAiLimiters ??= {});
  return (all[name] ??= new RateLimiter(limit, windowMs));
}
