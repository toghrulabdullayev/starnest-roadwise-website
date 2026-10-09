import { createRateLimiter, type RateLimiter } from "../../auth/rateLimit.ts";

export const CHAT_LIMIT = 12;
export const CHAT_WINDOW_MS = 60_000;

const globalForChat = globalThis as unknown as { roadwiseChatLimiter?: RateLimiter };

export function chatLimiter(): RateLimiter {
  globalForChat.roadwiseChatLimiter ??= createRateLimiter({
    limit: CHAT_LIMIT,
    windowMs: CHAT_WINDOW_MS,
  });
  return globalForChat.roadwiseChatLimiter;
}
