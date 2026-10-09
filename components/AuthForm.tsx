"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { AuthState } from "@/lib/auth/actions";

type Mode = "login" | "signup";

export function AuthForm({
  mode,
  locale,
  next,
  action,
  labels,
  alternateHref,
}: {
  mode: Mode;
  locale: string;
  next: string;
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  labels: Dictionary["auth"];
  alternateHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";
  const errorId = "auth-error";
  const inputClass =
    "min-h-11 w-full border-2 border-current bg-background px-3 font-mono text-base";

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-6" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />

      {isSignup ? (
        <label className="flex flex-col gap-2">
          <span className="font-mono text-sm uppercase">{labels.displayName}</span>
          <input
            name="display_name"
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            className={inputClass}
            aria-invalid={state.error === "name_required" || undefined}
            aria-describedby={state.error ? errorId : undefined}
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="font-mono text-sm uppercase">{labels.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.email ?? ""}
          className={inputClass}
          aria-invalid={
            state.error === "invalid_email" || state.error === "email_taken" || undefined
          }
          aria-describedby={state.error ? errorId : undefined}
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-sm uppercase">{labels.password}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className={inputClass}
          aria-invalid={
            state.error === "password_too_short" ||
            state.error === "password_too_long" ||
            undefined
          }
          aria-describedby={state.error ? errorId : undefined}
        />
        {isSignup ? (
          <span className="font-mono text-sm">{labels.passwordHint}</span>
        ) : null}
      </label>

      <div id={errorId} role="alert" aria-live="polite">
        {state.error ? (
          <p className="border-2 border-danger px-3 py-2 font-mono text-sm text-danger">
            {labels.errors[state.error]}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 bg-primary px-6 font-display uppercase text-white hover:bg-foreground hover:text-background disabled:opacity-60"
      >
        {pending
          ? labels.submitting
          : isSignup
            ? labels.signupSubmit
            : labels.loginSubmit}
      </button>

      <p className="font-mono text-sm">
        {isSignup ? labels.haveAccount : labels.noAccount}{" "}
        <Link href={alternateHref} className="underline">
          {isSignup ? labels.loginSubmit : labels.signupSubmit}
        </Link>
      </p>
    </form>
  );
}
