import { z } from "zod";
import { startDeviceLink } from "@/lib/auth/deviceLink";
import { RateLimiter } from "@/lib/auth/rateLimit";
import { json, readJson, verifyUrl } from "@/lib/http";

const limiter = new RateLimiter(30, 10 * 60 * 1000);
const body = z.object({ client: z.string().max(64).optional(), client_version: z.string().max(32).optional() });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!limiter.hit(ip).allowed) return json({ error: "slow_down" }, 429);
  const parsed = body.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const link = await startDeviceLink(parsed.data.client ?? null, parsed.data.client_version ?? null);
  return json({ ...link, verify_url: verifyUrl(link.user_code) });
}
