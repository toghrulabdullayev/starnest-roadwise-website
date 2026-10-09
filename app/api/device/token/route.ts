import { exchangeDeviceCode } from "@/lib/auth/deviceLink";
import { json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { device_code?: unknown } | null;
  const result = await exchangeDeviceCode(body?.device_code);
  if (!result.ok) return json({ error: result.error }, 400);
  const { user } = result;
  return json({
    access_token: result.access_token,
    token_type: "Bearer",
    user: { id: user.id, display_name: user.display_name, locale: user.locale },
  });
}
