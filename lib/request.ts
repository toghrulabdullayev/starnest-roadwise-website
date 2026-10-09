import "server-only";
import { headers } from "next/headers";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}
