/**
 * Shared UI primitives — "Bold" design system (.claude/skills/design-system).
 * Tokens come from app/globals.css; every interactive element is ≥44px,
 * has explicit hover / focus-visible / active / disabled states.
 */
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "dark" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-white border-surface hover:bg-primary-hover active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shadow-bold-sm",
  secondary:
    "bg-canvas text-text border-surface hover:bg-canvas-2 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shadow-bold-sm",
  dark: "bg-surface text-text-on-dark border-surface hover:bg-surface-2 active:translate-x-0.5 active:translate-y-0.5",
  ghost: "bg-transparent text-text border-transparent hover:border-surface",
  danger:
    "bg-canvas text-danger-ink border-danger hover:bg-danger hover:text-white active:translate-x-0.5 active:translate-y-0.5",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `inline-flex min-h-11 items-center justify-center gap-2 border-2 px-5 py-2 font-bold uppercase tracking-wide transition-[transform,background-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 ${variants[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel,
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; loading?: boolean; loadingLabel?: string }) {
  return (
    <button {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, className)}>
      {loading && <span aria-hidden="true" className="inline-block size-4 animate-spin border-2 border-current border-t-transparent rounded-full" />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  ...input
}: ComponentProps<"input"> & { id: string; label: string; error?: string; hint?: string }) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <input
        id={id}
        {...input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-12 border-2 bg-canvas px-3 text-base text-text placeholder:text-text-muted focus-visible:outline-offset-0 ${
          error ? "border-danger" : "border-surface"
        }`}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "success" | "info" | "warning"; children: ReactNode }) {
  const tones = {
    danger: "border-danger bg-[#fef2f2] text-danger-ink",
    success: "border-success bg-[#f0fdf4] text-success-ink",
    info: "border-primary bg-[#eff8ff] text-primary-ink",
    warning: "border-warning bg-[#fffbeb] text-warning-ink",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} tabIndex={-1} className={`border-l-8 border-2 px-4 py-3 font-semibold focus-visible:outline-offset-2 ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`border-2 border-surface bg-canvas p-4 shadow-bold sm:p-6 ${className}`}>{children}</Tag>;
}

/**
 * The product name is English in every locale. Marking it lang="en" keeps uppercase text
 * "ROADWISE": under lang="az" the browser would uppercase its i as the dotted "İ".
 */
export function withBrand(text: string): ReactNode {
  const parts = text.split("Roadwise");
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<span key={i} lang="en">Roadwise</span>, part]));
}

export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p className={`font-mono text-xs font-bold uppercase tracking-[0.2em] ${onDark ? "text-primary-on-dark" : "text-primary-ink"}`}>
      {children}
    </p>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "primary"; children: ReactNode }) {
  const tones = {
    neutral: "border-surface bg-canvas-2 text-text",
    success: "border-success-ink bg-[#f0fdf4] text-success-ink",
    warning: "border-warning-ink bg-[#fffbeb] text-warning-ink",
    danger: "border-danger-ink bg-[#fef2f2] text-danger-ink",
    primary: "border-primary-ink bg-[#eff8ff] text-primary-ink",
  };
  return <span className={`inline-flex items-center border-2 px-2 py-0.5 font-mono text-xs font-bold uppercase ${tones[tone]}`}>{children}</span>;
}
