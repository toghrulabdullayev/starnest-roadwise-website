"use client";

import { useActionState } from "react";
import { buildPlanAction, type PlanFormState } from "@/app/actions/learning";
import { Alert, Button } from "@/components/ui";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/getDictionary";

export function PlanForm({ locale, label, labels }: { locale: Locale; label: string; labels: Dictionary["learn"] }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(buildPlanAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="primary" loading={pending} loadingLabel={labels.planBuilding}>
        {label}
      </Button>
      {state.error && <Alert tone="danger">{state.error === "rate_limited" ? labels.planLimit : labels.planError}</Alert>}
    </form>
  );
}
