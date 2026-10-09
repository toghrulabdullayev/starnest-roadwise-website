import { NextResponse } from "next/server";
import { json } from "@/lib/http";

export const forbidden = () => json({ error: "forbidden" }, 403);

export const tooManyRequests = (retryAfterMs: number, message?: string) => {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return NextResponse.json(
    { error: "rate_limited", retry_after_s: seconds, ...(message ? { message } : {}) },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(seconds) } },
  );
};
