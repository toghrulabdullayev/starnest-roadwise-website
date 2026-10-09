"use server";

import { approveDevice, normalizeUserCode } from "@/lib/auth/deviceLink";
import { revokeGameToken } from "@/lib/auth/gameToken";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { revalidatePath } from "next/cache";

export type ApproveState = { result?: "approved" | "expired" | "invalid" | "login_required" };

export async function approveDeviceAction(_prev: ApproveState, formData: FormData): Promise<ApproveState> {
  const user = await getCurrentUser();
  if (!user) return { result: "login_required" };
  const code = normalizeUserCode(formData.get("code"));
  if (!code) return { result: "invalid" };
  return { result: await approveDevice(code, user.id) };
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = String(formData.get("id") ?? "");
  if (id) await revokeGameToken(id, user.id);
  revalidatePath("/[locale]/profile", "page");
}
