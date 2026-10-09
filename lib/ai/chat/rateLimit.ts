import { RateLimiter } from "../../auth/rateLimit";

export const CHAT_LIMIT = 12;
export const CHAT_WINDOW_MS = 60_000;

const globalForChat = globalThis as unknown as { roadwiseChatLimiter?: RateLimiter };

/** Per-user chat limit (best-effort, per instance — same caveat as the login limiter). */
export function chatLimiter(): RateLimiter {
  globalForChat.roadwiseChatLimiter ??= new RateLimiter(CHAT_LIMIT, CHAT_WINDOW_MS);
  return globalForChat.roadwiseChatLimiter;
}
