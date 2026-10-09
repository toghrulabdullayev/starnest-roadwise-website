"use client";

import { useActionState } from "react";
import { approveDeviceAction, type ApproveState } from "@/app/actions/device";
import { Alert, Button } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n/getDictionary";

export function ApproveForm({ code, t }: { code: string; t: Dictionary["link"] }) {
  const [state, action, pending] = useActionState<ApproveState, FormData>(approveDeviceAction, {});
  if (state.result === "approved") {
    return (
      <div className="flex flex-col gap-2 border-2 border-success-ink bg-[#f0fdf4] p-4" role="status">
        <p className="font-display text-xl uppercase text-success-ink">{t.successTitle}</p>
        <p className="font-semibold">{t.successBody}</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="code" value={code} />
      {state.result === "expired" && <Alert>{t.expiredBody}</Alert>}
      {state.result === "invalid" && <Alert>{t.invalidBody}</Alert>}
      <Button type="submit" loading={pending} loadingLabel={t.working} className="w-full">
        {t.authorise}
      </Button>
    </form>
  );
}
