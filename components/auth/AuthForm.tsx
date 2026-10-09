"use client";

import { useActionState } from "react";
import Link from "next/link";
import { logInAction, signUpAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, Button, Field } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";

export function AuthForm({
  mode,
  locale,
  t,
  next,
}: {
  mode: "login" | "signup";
  locale: Locale;
  t: Dictionary["auth"];
  next?: string;
}) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    mode === "login" ? logInAction : signUpAction,
    {},
  );
  const fe = state.fields ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <Alert>{t.errors[state.error]}</Alert>}
      {mode === "signup" && (
        <Field
          id="displayName"
          name="displayName"
          label={t.displayName}
          autoComplete="name"
          required
          defaultValue={state.values?.displayName}
          error={fe.displayName && t.errors[fe.displayName]}
        />
      )}
      <Field
        id="email"
        name="email"
        type="email"
        label={t.email}
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={fe.email && t.errors[fe.email]}
      />
      <Field
        id="password"
        name="password"
        type="password"
        label={t.password}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        minLength={mode === "signup" ? 8 : undefined}
        hint={mode === "signup" ? t.passwordHint : undefined}
        error={fe.password && t.errors[fe.password]}
      />
      <Button type="submit" loading={pending} loadingLabel={t.working} className="w-full">
        {mode === "login" ? t.loginButton : t.signupButton}
      </Button>
      <p className="text-center">
        {mode === "login" ? t.noAccount : t.haveAccount}{" "}
        <Link
          href={`/${locale}/${mode === "login" ? "signup" : "login"}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-bold text-primary-ink underline decoration-2 underline-offset-4 hover:text-primary-hover"
        >
          {mode === "login" ? t.signupButton : t.loginButton}
        </Link>
      </p>
    </form>
  );
}
